'use strict';

const { MusicClient } = require('./constants');
const { apiError, emptyError, transportError } = require('./errors');
const { parseAjax, tracksIn, playlistsIn, reloadKey, formBody } = require('./vk-parse');
const { firstNonEmpty, sleep, throwIfAborted } = require('./util');
const { VKPageBridge } = require('./vk-bridge');

const EXTRA_COOKIES = 'remixaudio_show_alert_today=0; remixmdevice=1920/1080/2/!!-!!!!';
const AJAX_HOSTS = ['https://vk.ru/al_audio.php', 'https://m.vk.ru/audio'];
// Страница-мост для reload поднимается только если быстрый HTTP-запрос не успел, чтобы не держать лишнее окно.
const RELOAD_BRIDGE_DELAY_MS = 450;

class VKWebMusic {
  constructor() {
    this.library = new VKPageBridge();
    this.reloader = new VKPageBridge();
  }

  async audios(cookies, ownerId, playlistId, accessKey, signal) {
    const pageTracks = await this.library.loadAudios(ownerId, playlistId ?? null, signal);
    if (pageTracks.length) return pageTracks;

    const params = {
      act: 'load_section',
      owner_id: String(ownerId),
      playlist_id: String(playlistId ?? -1),
      offset: '0',
      type: 'playlist',
      is_loading_all: '1',
      al: '1'
    };
    if (accessKey && accessKey.length < 24) params.access_hash = accessKey;
    const json = await this.post(AJAX_HOSTS, params, cookies, signal);
    const tracks = tracksIn(json);
    if (!tracks.length) throw apiError('Сайт VK не вернул список треков');
    return tracks;
  }

  async search(cookies, query, ownerId, signal) {
    try {
      const page = await this.library.search(query, signal);
      if (page.length) return page;
    } catch {
      // Переходим на прямой запрос.
    }
    const json = await this.post(AJAX_HOSTS, {
      act: 'section',
      al: '1',
      owner_id: String(ownerId),
      section: 'search',
      q: query
    }, cookies, signal);
    return tracksIn(json);
  }

  async playlists(cookies, ownerId, signal) {
    const json = await this.post(['https://vk.ru/al_audio.php'], {
      act: 'section',
      al: '1',
      owner_id: String(ownerId),
      section: 'all'
    }, cookies, signal);
    return playlistsIn(json);
  }

  async sectionTracks(cookies, ownerId, section, signal) {
    const json = await this.post(['https://vk.ru/al_audio.php'], {
      act: 'section',
      al: '1',
      owner_id: String(ownerId),
      section
    }, cookies, signal);
    return tracksIn(json);
  }

  async reloadURL(cookies, track, signal) {
    const key = reloadKey(track);
    const jobs = [
      async (inner) => {
        const json = await this.post(['https://m.vk.ru/audio', 'https://vk.ru/al_audio.php'], {
          act: 'reload_audio',
          ids: key,
          al: '1'
        }, cookies, inner);
        return tracksIn(json)[0]?.url ?? '';
      },
      async (inner) => {
        await sleep(RELOAD_BRIDGE_DELAY_MS);
        throwIfAborted(inner);
        return this.reloader.reload(track, inner);
      }
    ];
    const url = await firstNonEmpty(jobs, '', (value) => !value);
    if (!url) throw apiError('У трека нет ссылки на воспроизведение');
    return url;
  }

  async post(urls, params, cookies, signal) {
    let last = emptyError();
    for (const url of urls) {
      throwIfAborted(signal);
      try {
        const json = await this.sessionPost(url, params, cookies, signal);
        if (tracksIn(json).length || json.data !== undefined || json.payload !== undefined) return json;
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        last = error;
      }
    }
    throw last;
  }

  async sessionPost(url, params, cookies, signal) {
    const headers = {
      'User-Agent': MusicClient.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://vk.ru/audio',
      Origin: 'https://vk.ru'
    };
    if (cookies) headers.Cookie = `${cookies}; ${EXTRA_COOKIES}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: formBody(params),
        signal: combine(signal, AbortSignal.timeout(20_000))
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw transportError(error.message || 'Нет соединения с ВКонтакте');
    }
    const text = await decode(response);
    const json = parseAjax(text);
    if (!json) throw emptyError();
    return json;
  }

  close() {
    this.library.close();
    this.reloader.close();
  }
}

async function decode(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset && charset !== 'utf-8' ? charset : 'utf-8').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function combine(...signals) {
  const active = signals.filter(Boolean);
  return active.length === 1 ? active[0] : AbortSignal.any(active);
}

module.exports = { VKWebMusic, combine };
