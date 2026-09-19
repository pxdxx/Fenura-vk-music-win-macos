'use strict';

// Разбор ответов VK: чистые функции без сети, перенос VKWebMusic.swift.

function intValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) return parseInt(value, 10);
  return null;
}

function str(value) {
  return typeof value === 'string' ? value : null;
}

function cleanURL(raw) {
  if (typeof raw !== 'string' || raw.includes('audio_api_unavailable')) return '';
  let url = raw.trim();
  if (url.startsWith('//')) url = 'https:' + url;
  return url.startsWith('http') ? url : '';
}

function validURL(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

function firstURL(dict, keys) {
  if (!dict || typeof dict !== 'object') return null;
  for (const key of keys) {
    const value = validURL(dict[key]);
    if (value) return value;
  }
  return null;
}

function cover(item) {
  const thumb = item.thumb;
  if (thumb && typeof thumb === 'object') {
    const url = firstURL(thumb, ['photo_1200', 'photo_600', 'photo_300', 'photo_270']);
    if (url) return url;
  }
  const album = item.album;
  if (album && typeof album === 'object' && album.thumb && typeof album.thumb === 'object') {
    const url = firstURL(album.thumb, ['photo_600', 'photo_300']);
    if (url) return url;
  }
  return null;
}

function coverURL(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const parts = raw.split(',');
  return validURL(parts[parts.length - 1]);
}

function reloadId(ownerId, audioId, hashes) {
  const parts = String(hashes).split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${ownerId}_${audioId}_${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
  }
  return `${ownerId}_${audioId}`;
}

function reloadKey(track) {
  const access = track.accessKey;
  if (access && access.includes(`${track.ownerId}_${track.audioId}`)) return access;
  if (access) return `${track.ownerId}_${track.audioId}_${access}`;
  return `${track.ownerId}_${track.audioId}`;
}

function makeTrack(fields) {
  return {
    id: `${fields.ownerId}_${fields.audioId}`,
    ownerId: fields.ownerId,
    audioId: fields.audioId,
    artist: fields.artist,
    title: fields.title,
    duration: fields.duration,
    url: fields.url,
    artworkURL: fields.artworkURL,
    accessKey: fields.accessKey ?? null,
    isAdded: false
  };
}

function trackFromObject(item) {
  const audioId = intValue(item.id ?? item.audio_id);
  const ownerId = intValue(item.owner_id);
  const title = str(item.title);
  if (audioId === null || ownerId === null || !title) return null;
  return makeTrack({
    ownerId,
    audioId,
    artist: str(item.artist) || 'Unknown',
    title,
    duration: intValue(item.duration) ?? 0,
    url: cleanURL(item.url),
    artworkURL: cover(item),
    accessKey: str(item.access_key)
  });
}

function trackFromArray(item) {
  if (item.length < 6) return null;
  const audioId = intValue(item[0]);
  const ownerId = intValue(item[1]);
  if (audioId === null || ownerId === null) return null;
  const title = str(item[3]) || '';
  const artist = str(item[4]) || '';
  if (!title && !artist) return null;
  const hashes = str(item[13]) || '';
  return makeTrack({
    ownerId,
    audioId,
    artist: artist || 'Unknown',
    title: title || 'Без названия',
    duration: intValue(item[5]) ?? 0,
    url: cleanURL(str(item[2])),
    artworkURL: coverURL(str(item[14])),
    accessKey: reloadId(ownerId, audioId, hashes)
  });
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

function tracksIn(json) {
  const found = [];
  const seen = new Set();
  walk(json, (value) => {
    if (!value || typeof value !== 'object') return;
    const track = Array.isArray(value) ? trackFromArray(value) : trackFromObject(value);
    if (track && !seen.has(track.id)) {
      seen.add(track.id);
      found.push(track);
    }
  });
  return found;
}

function playlistsIn(json) {
  const playlists = [];
  const seen = new Set();
  walk(json, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const playlistId = intValue(value.id ?? value.playlist_id);
    const ownerId = intValue(value.owner_id);
    const title = str(value.title);
    if (playlistId === null || ownerId === null || !title) return;
    const id = `${ownerId}_${playlistId}`;
    if (seen.has(id)) return;
    seen.add(id);
    playlists.push({
      id,
      ownerId,
      playlistId,
      title,
      subtitle: str(value.description) || '',
      count: intValue(value.count ?? value.size) ?? 0,
      artworkURL: null,
      accessKey: str(value.access_hash) || str(value.access_key)
    });
  });
  return playlists;
}

function tryJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isDict(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAjax(text) {
  if (typeof text !== 'string') return null;
  const direct = tryJSON(text);
  if (isDict(direct)) return direct;

  const start = text.indexOf('<!json>');
  if (start >= 0) {
    const rest = text.slice(start + '<!json>'.length);
    const end = rest.indexOf('<!>');
    if (end >= 0) {
      const parsed = tryJSON(rest.slice(0, end));
      if (isDict(parsed)) return parsed;
      if (Array.isArray(parsed)) return { list: parsed };
    }
  }

  const brace = text.indexOf('{');
  if (brace >= 0) {
    const parsed = tryJSON(text.slice(brace));
    if (isDict(parsed)) return parsed;
  }
  return null;
}

function parseTracks(raw) {
  return itemsOf(raw).map(trackFromApiItem).filter(Boolean);
}

function itemsOf(raw) {
  if (isDict(raw) && Array.isArray(raw.items)) return raw.items.filter(isDict);
  if (Array.isArray(raw)) return raw.filter(isDict);
  return [];
}

// Треки из официального API (audio.get и др.): в отличие от веб-разбора, здесь нужны строгие поля.
function trackFromApiItem(item) {
  const audioId = intValue(item.id);
  const ownerId = intValue(item.owner_id);
  if (audioId === null || ownerId === null) return null;
  return makeTrack({
    ownerId,
    audioId,
    artist: str(item.artist) ?? 'Unknown',
    title: str(item.title) ?? 'Без названия',
    duration: intValue(item.duration) ?? 0,
    url: cleanURL(str(item.url) ?? ''),
    artworkURL: apiArtwork(item),
    accessKey: str(item.access_key)
  });
}

function apiArtwork(item) {
  const keys = ['photo_1200', 'photo_600', 'photo_300', 'photo_270', 'photo_135'];
  if (isDict(item.thumb)) return firstURL(item.thumb, keys);
  if (isDict(item.album)) {
    if (isDict(item.album.thumb)) return firstURL(item.album.thumb, keys);
    return validURL(item.album.thumb);
  }
  return null;
}

function parsePlaylists(raw) {
  return itemsOf(raw)
    .map((item) => {
      const playlistId = intValue(item.id);
      const ownerId = intValue(item.owner_id);
      if (playlistId === null || ownerId === null) return null;
      const count = intValue(item.count) ?? 0;
      const description = str(item.description) || '';
      return {
        id: `${ownerId}_${playlistId}`,
        ownerId,
        playlistId,
        title: str(item.title) ?? 'Плейлист',
        subtitle: description || `${count} треков`,
        count,
        artworkURL: playlistArt(item),
        accessKey: str(item.access_key)
      };
    })
    .filter(Boolean);
}

function playlistArt(item) {
  if (isDict(item.photo)) {
    return firstURL(item.photo, ['photo_1200', 'photo_680', 'photo_600', 'photo_300', 'photo_270']);
  }
  if (Array.isArray(item.thumbs) && isDict(item.thumbs[0])) {
    return firstURL(item.thumbs[0], ['photo_1200', 'photo_680', 'photo_600', 'photo_300']);
  }
  return null;
}

function formEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function formBody(params) {
  return Object.entries(params)
    .map(([key, value]) => `${formEncode(key)}=${formEncode(value)}`)
    .join('&');
}

module.exports = {
  intValue,
  cleanURL,
  reloadKey,
  reloadId,
  parseAjax,
  tracksIn,
  playlistsIn,
  parseTracks,
  parsePlaylists,
  formBody,
  isDict
};
