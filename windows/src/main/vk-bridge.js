'use strict';

const { BrowserWindow } = require('electron');
const { PARTITION, MusicClient } = require('./constants');
const { parseAjax, tracksIn, reloadKey } = require('./vk-parse');
const { sleep, throwIfAborted } = require('./util');

const CAPTURE = /audio|catalog|al_audio|music/i;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

// Скрытая страница ВКонтакте с общими куками входа. Сайт сам делает запросы за музыкой,
// а мы читаем их ответы через DevTools Protocol (аналог VKPageBridge на WKWebView).
class VKPageBridge {
  constructor() {
    this.win = null;
    this.captured = [];
    this.requests = new Map();
    this.chain = Promise.resolve();
    this.idleTimer = null;
    this.lastKey = '';
    this.lastTracks = [];
    this.lastLoad = 0;
  }

  // Одна страница на весь мост, поэтому задачи идут строго по очереди.
  run(task, signal) {
    const result = this.chain.then(() => {
      throwIfAborted(signal);
      return task();
    });
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      show: false,
      width: 980,
      height: 720,
      webPreferences: {
        partition: PARTITION,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    win.webContents.setUserAgent(MusicClient.userAgent);
    win.webContents.setAudioMuted(true);
    win.on('closed', () => {
      this.win = null;
    });
    this.win = win;
    this.captured = [];
    this.requests.clear();
    this.attachDebugger(win.webContents);
    return win;
  }

  attachDebugger(wc) {
    try {
      wc.debugger.attach('1.3');
    } catch {
      return;
    }
    const send = (method, params) => wc.debugger.sendCommand(method, params).catch(() => undefined);
    send('Network.enable');
    send('Network.setBlockedURLs', {
      urls: ['*.jpg', '*.jpeg', '*.png', '*.gif', '*.webp', '*.svg', '*.woff', '*.woff2', '*.mp3', '*.mp4', '*.m3u8']
    });
    wc.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.responseReceived') {
        const type = params.type;
        if ((type === 'XHR' || type === 'Fetch') && CAPTURE.test(params.response.url)) {
          this.requests.set(params.requestId, params.response.url);
        }
      } else if (method === 'Network.loadingFinished') {
        if (!this.requests.has(params.requestId)) return;
        this.requests.delete(params.requestId);
        wc.debugger
          .sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((body) => {
            const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
            const json = parseAjax(text);
            if (json) this.captured.push(json);
          })
          .catch(() => undefined);
      }
    });
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  close() {
    clearTimeout(this.idleTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  async open(url) {
    const wc = this.ensureWindow().webContents;
    this.touch();
    if (wc.getURL() === url) return;
    const started = Date.now();
    wc.loadURL(url).catch(() => undefined);
    while (Date.now() - started < 2400) {
      if (!wc.isLoading() && wc.getURL() && Date.now() - started > 250) break;
      await sleep(80);
    }
  }

  tracksFromCaptured() {
    const all = [];
    const seen = new Set();
    for (const json of this.captured) {
      for (const track of tracksIn(json)) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          all.push(track);
        }
      }
    }
    return all;
  }

  async waitForTracks(limit) {
    for (let i = 0; i < limit; i++) {
      const tracks = this.tracksFromCaptured();
      if (tracks.length) return tracks;
      await sleep(120);
    }
    return this.tracksFromCaptured();
  }

  loadAudios(ownerId, playlistId, signal) {
    return this.run(async () => {
      const key = `${ownerId}_${playlistId ?? 0}`;
      if (this.lastKey === key && Date.now() - this.lastLoad < 90_000 && this.lastTracks.length) {
        return this.lastTracks;
      }
      this.captured = [];
      const target = playlistId == null
        ? `https://vk.ru/music/playlist/${ownerId}_15`
        : `https://vk.ru/music/playlist/${ownerId}_${playlistId}`;
      await this.open(target);
      await this.resolveGate();
      let tracks = await this.waitForTracks(6);
      if (!tracks.length) tracks = await this.pullFromPage(ownerId);
      if (tracks.length) {
        this.lastKey = key;
        this.lastTracks = tracks;
        this.lastLoad = Date.now();
      }
      return tracks;
    }, signal);
  }

  search(query, signal) {
    return this.run(async () => {
      this.captured = [];
      await this.open(`https://vk.ru/audio?q=${encodeURIComponent(query)}`);
      return this.waitForTracks(5);
    }, signal);
  }

  reload(track, signal) {
    return this.run(async () => {
      const text = await this.fetchOnPage('https://vk.ru/al_audio.php', {
        act: 'reload_audio',
        ids: reloadKey(track),
        al: '1'
      });
      const json = parseAjax(text);
      return json ? (tracksIn(json)[0]?.url ?? '') : '';
    }, signal);
  }

  async pullFromPage(ownerId) {
    const wc = this.win.webContents;
    const owner = Number(ownerId);
    const script = `(async () => {
      const html = document.documentElement.innerHTML;
      const token = (html.match(/"access_token"\\s*:\\s*"(vk1\\.[^"]+)"/) || [])[1] || '';
      const out = { href: location.href, token: token };
      if (token) {
        const base = '&access_token=' + encodeURIComponent(token) + '&lang=ru&client_id=${MusicClient.appID}';
        try {
          const res = await fetch('https://api.vk.ru/method/catalog.getAudio?v=${MusicClient.version}' + base, {
            method: 'POST',
            body: new URLSearchParams({ owner_id: String(${owner}), need_blocks: '1' }),
            credentials: 'include'
          });
          out.catalog = await res.json();
        } catch (e) {}
        try {
          const res2 = await fetch('https://api.vk.ru/method/audio.get?v=${MusicClient.version}' + base, {
            method: 'POST',
            body: new URLSearchParams({ owner_id: String(${owner}), count: '200' }),
            credentials: 'include'
          });
          out.audioGet = await res2.json();
        } catch (e) {}
      }
      return out;
    })()`;
    let result;
    try {
      result = await wc.executeJavaScript(script, true);
    } catch {
      return [];
    }
    for (const key of ['catalog', 'audioGet']) {
      if (result && result[key]) {
        const tracks = tracksIn(result[key]);
        if (tracks.length) return tracks;
      }
    }
    return [];
  }

  async fetchOnPage(url, params) {
    await this.open('https://vk.ru/audio');
    const wc = this.win.webContents;
    const script = `(async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(${JSON.stringify(params)}),
        credentials: 'include'
      });
      return await response.text();
    })()`;
    try {
      return (await wc.executeJavaScript(script, true)) || '';
    } catch {
      return '';
    }
  }

  // ВКонтакте иногда ведёт через страницу-шлюз с адресом назначения в параметре `to` (base64).
  async resolveGate() {
    if (!this.win) return;
    const current = this.win.webContents.getURL();
    if (!current) return;
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return;
    }
    const to = parsed.searchParams.get('to');
    const path = to ? decodeVKPath(to) : null;
    if (path) {
      const host = parsed.host.includes('m.vk') ? 'https://m.vk.ru' : 'https://vk.ru';
      await this.open(host + path);
    }
  }
}

function decodeVKPath(value) {
  let text = value.replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4 !== 0) text += '=';
  try {
    const path = Buffer.from(text, 'base64').toString('utf8');
    return path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}

module.exports = { VKPageBridge, decodeVKPath };
