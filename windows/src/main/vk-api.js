'use strict';

const { KateClient, MusicClient } = require('./constants');
const { apiError, emptyError, transportError } = require('./errors');
const {
  intValue,
  cleanURL,
  reloadKey,
  parseTracks,
  parsePlaylists,
  formBody,
  isDict
} = require('./vk-parse');
const { firstNonEmpty, withTimeout, now } = require('./util');
const { VKWebMusic, combine } = require('./vk-web');

const TRACK_CACHE_MS = 180_000;
const URL_CACHE_MS = 10 * 60_000;
const RESOLVE_TIMEOUT_MS = 5_500;

function canRefreshMusic(vk) {
  return (vk.cookieHeader || '').includes('remixsid');
}

class VKAPI {
  constructor(web = new VKWebMusic()) {
    this.web = web;
    this.trackCache = new Map();
    this.urlCache = new Map();
    this.pendingMusic = null;
  }

  // ---- Сессия ----

  async resolveMusicSession(vk) {
    const next = { ...vk };
    const cookies = next.cookieHeader;
    if (!cookies || !cookies.includes('remixsid')) {
      throw apiError('Сессия ВКонтакте без доступа к музыке. Выйдите и войдите ещё раз');
    }
    if (next.token.startsWith('vk1.') && next.clientID && (next.tokenExpires || 0) - 90 > now()) {
      return next;
    }
    // Параллельные вызовы делят один запрос токена, иначе на старте их уходит пять подряд.
    if (!this.pendingMusic) {
      this.pendingMusic = this.fetchMusicToken(cookies).finally(() => {
        this.pendingMusic = null;
      });
    }
    const music = await this.pendingMusic;
    next.token = music.token;
    if (music.userId !== 0) next.userId = music.userId;
    next.userAgent = MusicClient.userAgent;
    next.tokenExpires = music.expires;
    next.clientID = music.appID;
    return next;
  }

  async fetchMusicToken(cookieHeader) {
    const endpoints = ['https://login.vk.ru/?act=web_token', 'https://login.vk.com/?act=web_token'];
    const apps = [MusicClient.appID, '2274003'];
    let lastError = apiError('Не удалось получить доступ к VK Музыке');
    for (const endpoint of endpoints) {
      for (const appID of apps) {
        try {
          return await this.fetchMusicTokenFrom(endpoint, cookieHeader, appID);
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError;
  }

  async fetchMusicTokenFrom(url, cookieHeader, appID) {
    const json = await this.requestJSON(url, { version: '1', app_id: appID }, {
      'User-Agent': MusicClient.userAgent,
      Origin: 'https://vk.ru',
      Referer: 'https://vk.ru/',
      Cookie: cookieHeader
    });
    if (json.type === 'error') {
      throw apiError(json.error_info || 'unauthorized');
    }
    const data = isDict(json.data) ? json.data : json;
    const token = data.access_token;
    if (typeof token !== 'string' || token.length <= 20) {
      throw apiError('VK не выдал токен музыки');
    }
    const userId = intValue(data.user_id) ?? 0;
    const rawExpires = intValue(data.expires) ?? 0;
    const expires = rawExpires > 1_000_000_000 ? rawExpires : now() + Math.max(rawExpires, 10_800);
    return { token, userId, expires, appID };
  }

  async profile(vk) {
    const params = { fields: 'photo_200,photo_100' };
    if (vk.userId !== 0) params.user_ids = String(vk.userId);
    const json = await this.method('users.get', vk, params);
    const first = Array.isArray(json.response) ? json.response[0] : null;
    if (!first) throw emptyError();
    return {
      id: intValue(first.id) ?? vk.userId,
      firstName: first.first_name || '',
      lastName: first.last_name || '',
      photoURL: first.photo_200 || first.photo_100 || null
    };
  }

  // ---- Музыка ----

  async audios(vk, { ownerId = null, playlistId = null, accessKey = null, offset = 0, count = 200 } = {}) {
    const key = `audios:${ownerId ?? vk.userId}:${playlistId ?? -1}`;
    const cached = this.cachedTracks(key);
    if (cached) return cached;

    const params = { count: String(count), offset: String(offset) };
    if (ownerId !== null) params.owner_id = String(ownerId);
    if (playlistId !== null) params.album_id = String(playlistId);
    if (accessKey) params.access_key = accessKey;

    const cookies = vk.cookieHeader || '';
    const owner = ownerId ?? vk.userId;
    const tracks = await this.firstTracks([
      async () => parseTracks((await this.method('audio.get', vk, params)).response),
      () => this.catalogTracks(vk, ownerId, (title, url) => {
        if (ownerId !== null && url.includes(`audios${ownerId}`)) return true;
        return title.includes('музык') || title.includes('аудио') || url.includes('/audios');
      }),
      async (signal) => {
        if (owner === 0) return [];
        return this.web.audios(cookies, owner, playlistId, accessKey, signal);
      }
    ]);
    if (!tracks.length) throw apiError('Сайт VK не вернул список треков');
    this.storeTracks(key, tracks);
    return tracks;
  }

  async playlists(vk, ownerId, { offset = 0, count = 100 } = {}) {
    try {
      const json = await this.method('audio.getPlaylists', vk, {
        owner_id: String(ownerId),
        count: String(count),
        offset: String(offset)
      });
      const list = parsePlaylists(json.response);
      if (list.length) return list;
    } catch {
      // Пробуем сайт.
    }
    try {
      const web = await this.web.playlists(vk.cookieHeader || '', ownerId);
      if (web.length) return web;
    } catch {
      // Пробуем каталог.
    }
    try {
      return await this.catalogPlaylists(vk, ownerId);
    } catch {
      return [];
    }
  }

  async searchTracks(vk, query, { offset = 0, count = 80 } = {}) {
    return this.firstTracks([
      async () => {
        const json = await this.method('audio.search', vk, {
          q: query,
          count: String(count),
          offset: String(offset),
          sort: '0',
          autocomplete: '1'
        });
        return parseTracks(json.response);
      },
      (signal) => this.web.search(vk.cookieHeader || '', query, vk.userId, signal)
    ]);
  }

  async searchPlaylists(vk, query, { count = 24 } = {}) {
    try {
      const json = await this.method('audio.searchPlaylists', vk, { q: query, count: String(count) });
      return parsePlaylists(json.response);
    } catch (error) {
      if (!isUnavailable(error)) throw error;
      try {
        const json = await this.method('audio.searchAlbums', vk, { q: query, count: String(count) });
        return parsePlaylists(json.response);
      } catch {
        return [];
      }
    }
  }

  async recommendations(vk, { count = 80, force = false } = {}) {
    if (!force) {
      const cached = this.cachedTracks('rec');
      if (cached) return cached;
    } else {
      this.dropTrackCache('rec');
    }
    const cookies = vk.cookieHeader || '';
    const tracks = await this.firstTracks([
      async () => parseTracks((await this.method('audio.getRecommendations', vk, { count: String(count) })).response),
      () => this.catalogTracks(vk, vk.userId, (title) => {
        return title.includes('вас') || title.includes('рекомен') || title.includes('микс');
      }),
      (signal) => this.web.sectionTracks(cookies, vk.userId, 'recoms', signal)
    ]);
    if (tracks.length) this.storeTracks('rec', tracks);
    return tracks;
  }

  async popular(vk, { count = 80 } = {}) {
    const cached = this.cachedTracks('pop');
    if (cached) return cached;
    const tracks = await this.firstTracks([
      async () => parseTracks((await this.method('audio.getPopular', vk, { count: String(count) })).response),
      () => this.catalogTracks(vk, null, (title) => {
        return title.includes('чарт') || title.includes('популяр') || title.includes('хит');
      }),
      (signal) => this.web.sectionTracks(vk.cookieHeader || '', vk.userId, 'explore', signal)
    ]);
    if (tracks.length) this.storeTracks('pop', tracks);
    return tracks;
  }

  async add(vk, track) {
    await this.method('audio.add', vk, { owner_id: String(track.ownerId), audio_id: String(track.audioId) });
  }

  async remove(vk, track) {
    await this.method('audio.delete', vk, { owner_id: String(track.ownerId), audio_id: String(track.audioId) });
  }

  // ---- Ссылки на воспроизведение ----

  async resolveURL(vk, track, force = false) {
    if (!force) {
      const cached = this.cachedURL(track.id);
      if (cached) return cached;
    } else {
      this.invalidateURL(track.id);
    }

    const found = await withTimeout(
      firstNonEmpty([
        (signal) => this.web.reloadURL(vk.cookieHeader || '', track, signal),
        () => this.getByIdURL(vk, track)
      ], '', (value) => !value),
      RESOLVE_TIMEOUT_MS,
      ''
    );
    if (found) {
      this.storeURL(track.id, found);
      return found;
    }
    const fallback = cleanURL(track.url);
    if (!force && fallback) {
      this.storeURL(track.id, fallback);
      return fallback;
    }
    throw apiError('У трека нет ссылки на воспроизведение');
  }

  async getByIdURL(vk, track) {
    const json = await this.method('audio.getById', vk, { audios: reloadKey(track) });
    const first = parseTracks(json.response)[0];
    const url = first ? cleanURL(first.url) : '';
    if (!url) throw emptyError();
    return url;
  }

  prefetchURLs(vk, tracks) {
    (async () => {
      for (const track of tracks.slice(0, 3)) {
        try {
          await this.resolveURL(vk, track);
        } catch {
          // Предзагрузка ссылок ничего не ломает.
        }
      }
    })();
  }

  invalidateURL(id) {
    this.urlCache.delete(id);
  }

  dropTrackCache(key) {
    this.trackCache.delete(key);
  }

  // ---- Каталог ----

  async catalogTracks(vk, ownerId, matching) {
    const params = { need_blocks: '1' };
    if (ownerId !== null && ownerId !== undefined) params.owner_id = String(ownerId);
    const json = await this.method('catalog.getAudio', vk, params);
    const response = isDict(json.response) ? json.response : {};
    const catalog = isDict(response.catalog) ? response.catalog : response;
    const sections = Array.isArray(catalog.sections) ? catalog.sections.filter(isDict) : [];
    const picked = sections.find((section) => {
      return matching(String(section.title || '').toLowerCase(), String(section.url || '').toLowerCase());
    }) || sections[0];
    if (picked && typeof picked.id === 'string') {
      return this.catalogSectionTracks(vk, picked.id);
    }
    const recent = parseTracks(response.audios);
    if (recent.length) return recent;
    throw apiError('VK не вернул раздел с музыкой');
  }

  async catalogSectionTracks(vk, sectionId) {
    const collected = [];
    let startFrom = null;
    for (let page = 0; page < 2; page++) {
      const params = { section_id: sectionId };
      if (startFrom) params.start_from = startFrom;
      const json = await this.method('catalog.getSection', vk, params);
      const response = isDict(json.response) ? json.response : {};
      collected.push(...parseTracks(response.audios ?? response));
      const next = isDict(response.section) ? response.section.next_from : null;
      if (typeof next === 'string' && next && next !== startFrom) {
        startFrom = next;
      } else {
        break;
      }
    }
    return collected;
  }

  async catalogPlaylists(vk, ownerId) {
    const json = await this.method('catalog.getAudio', vk, { owner_id: String(ownerId), need_blocks: '1' });
    const response = isDict(json.response) ? json.response : {};
    return parsePlaylists(response.playlists ?? response);
  }

  async firstTracks(jobs) {
    return firstNonEmpty(jobs, [], (list) => !Array.isArray(list) || list.length === 0);
  }

  // ---- Кэш ----

  cachedTracks(key) {
    const entry = this.trackCache.get(key);
    if (!entry || Date.now() - entry.time >= TRACK_CACHE_MS || !entry.tracks.length) return null;
    return entry.tracks;
  }

  storeTracks(key, tracks) {
    this.trackCache.set(key, { time: Date.now(), tracks });
    for (const track of tracks) {
      if (track.url) this.urlCache.set(track.id, { time: Date.now(), url: track.url });
    }
  }

  cachedURL(id) {
    const entry = this.urlCache.get(id);
    if (!entry || Date.now() - entry.time >= URL_CACHE_MS || !entry.url) return null;
    return entry.url;
  }

  storeURL(id, url) {
    this.urlCache.set(id, { time: Date.now(), url });
  }

  clearCaches() {
    this.trackCache.clear();
    this.urlCache.clear();
  }

  // ---- Запросы ----

  async method(name, vk, params) {
    let live = vk;
    if (canRefreshMusic(vk)) {
      try {
        live = await this.resolveMusicSession(vk);
        this.onSessionRefreshed?.(live);
      } catch {
        live = vk;
      }
    }
    return this.methodOnce(name, live, params, false);
  }

  async methodOnce(name, vk, params, retried) {
    const official = vk.token.startsWith('vk1.');
    const all = { ...params, access_token: vk.token, v: official ? MusicClient.version : KateClient.version, lang: 'ru' };
    if (official) {
      all.client_id = vk.clientID || MusicClient.appID;
    } else if (name.startsWith('audio.')) {
      all.https = '1';
      all.extended = '1';
    }
    const host = official ? 'https://api.vk.ru/method/' : 'https://api.vk.com/method/';
    const headers = {
      'User-Agent': official ? MusicClient.userAgent : (vk.userAgent || KateClient.userAgent),
      Origin: 'https://vk.ru',
      Referer: 'https://vk.ru/'
    };
    if (official && vk.cookieHeader) headers.Cookie = vk.cookieHeader;

    const json = await this.requestJSON(host + name, all, headers);
    if (isDict(json.error)) {
      const code = intValue(json.error.error_code) ?? 0;
      const message = json.error.error_msg || 'Ошибка VK';
      const blocked = String(message).toLowerCase().includes('blocked');
      if (!retried && !blocked && canRefreshMusic(vk) && [3, 5, 15].includes(code)) {
        const fresh = await this.resolveMusicSession({ ...vk, tokenExpires: 0 });
        this.onSessionRefreshed?.(fresh);
        return this.methodOnce(name, fresh, params, true);
      }
      throw apiError(message);
    }
    return json;
  }

  async requestJSON(url, params, headers = {}, signal) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': KateClient.userAgent,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers
        },
        body: formBody(params),
        signal: combine(signal, AbortSignal.timeout(30_000))
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw transportError(error.cause?.message || error.message || 'Нет соединения с ВКонтакте');
    }
    const text = await response.text();
    try {
      const object = JSON.parse(text);
      if (isDict(object)) return object;
    } catch {
      // Ниже разберём как ошибку.
    }
    if (text.includes('unauthorized') || text.includes('error')) throw apiError('unauthorized');
    throw emptyError();
  }
}

function isUnavailable(error) {
  const text = String(error && error.message).toLowerCase();
  return text.includes('unknown method')
    || text.includes('access denied')
    || text.includes('permission')
    || text.includes('blocked')
    || text.includes('authorization failed')
    || text.includes('не открыл музыку')
    || text.includes('нет доступа')
    || text.includes('не отдал музыку');
}

module.exports = { VKAPI, canRefreshMusic, isUnavailable };
