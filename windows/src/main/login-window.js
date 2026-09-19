'use strict';

const path = require('path');
const { BrowserWindow, session: electronSession } = require('electron');
const { MusicClient, PARTITION } = require('./constants');

// Вход выполняется на настоящей странице ВКонтакте: пароль, 2FA, QR и капчу показывает сам сайт.
// Мы ждём, пока появится кука remixsid или токен в адресе blank.html.

function sessionFromURL(raw) {
  if (typeof raw !== 'string' || !raw.includes('access_token=')) return null;
  const hash = raw.lastIndexOf('#');
  const query = raw.indexOf('?');
  const payload = hash >= 0 ? raw.slice(hash + 1) : query >= 0 ? raw.slice(query + 1) : raw;
  const values = new URLSearchParams(payload);
  const token = values.get('access_token');
  if (!token || token.length <= 20) return null;
  return {
    token,
    userId: parseInt(values.get('user_id') || '', 10) || 0,
    userAgent: MusicClient.userAgent
  };
}

function looksLoggedIn(url) {
  if (url.includes('not_robot') || url.includes('captcha')) return false;
  if (url.includes('/login') || url.includes('act=login')) return false;
  if (url.includes('id.vk.') && (url.includes('auth') || url.includes('login'))) return false;
  return url.includes('vk.ru') || url.includes('vk.com');
}

function prettyStatus(url) {
  if (url.includes('blank.html')) return 'Получаем доступ…';
  if (url.includes('captcha') || url.includes('not_robot')) return 'Пройдите проверку «я не робот»';
  if (url.includes('id.vk.')) return 'Войдите по QR или паролю в окне Fenura Sync';
  return 'Войдите в ВКонтакте в окне Fenura Sync';
}

class VKLoginWindow {
  constructor({ icon } = {}) {
    this.icon = icon;
    this.window = null;
    this.popups = new Set();
    this.watcher = null;
    this.finished = false;
    this.finishing = false;
    this.onSession = null;
    this.onStatus = null;
    this.contents = new Set();
  }

  present() {
    this.finished = false;
    this.finishing = false;
    if (!this.window || this.window.isDestroyed()) this.build();
    this.onStatus?.('Войдите в ВКонтакте в отдельном окне');
    this.window.show();
    this.window.focus();
    if (!this.window.webContents.getURL()) {
      this.window.webContents.loadURL('https://vk.ru').catch(() => undefined);
    }
    this.startWatching();
  }

  dismiss() {
    clearInterval(this.watcher);
    this.watcher = null;
    for (const popup of this.popups) {
      if (!popup.isDestroyed()) popup.destroy();
    }
    this.popups.clear();
    this.contents.clear();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  isOpen() {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  build() {
    const ses = electronSession.fromPartition(PARTITION);
    ses.setUserAgent(MusicClient.userAgent);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'notifications' || permission === 'clipboard-sanitized-write');
    });

    const window = new BrowserWindow({
      width: 980,
      height: 720,
      title: 'Fenura Sync',
      icon: this.icon,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    window.removeMenu();
    window.once('ready-to-show', () => window.show());
    window.on('page-title-updated', (event) => event.preventDefault());
    window.on('closed', () => {
      clearInterval(this.watcher);
      this.watcher = null;
    });

    const wc = window.webContents;
    wc.setUserAgent(MusicClient.userAgent);
    this.observe(wc);
    wc.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        title: 'ВКонтакте',
        icon: this.icon,
        autoHideMenuBar: true,
        parent: window
      }
    }));
    wc.on('did-create-window', (child) => {
      child.removeMenu();
      this.popups.add(child);
      child.on('closed', () => this.popups.delete(child));
      child.webContents.setUserAgent(MusicClient.userAgent);
      this.observe(child.webContents);
      this.onStatus?.('Дополнительное окно ВКонтакте…');
    });

    this.window = window;
  }

  observe(wc) {
    const consume = (_event, url) => this.consume(url);
    wc.on('will-navigate', consume);
    wc.on('will-redirect', consume);
    wc.on('did-redirect-navigation', consume);
    wc.on('did-navigate-in-page', consume);
    wc.on('did-navigate', (_event, url) => {
      this.consume(url);
      this.onStatus?.(prettyStatus(url));
    });
    wc.on('did-finish-load', () => {
      const url = wc.getURL();
      this.consume(url);
      this.onStatus?.(prettyStatus(url));
      this.finishIfLoggedIn();
    });
    this.contents.add(wc);
  }

  consume(url) {
    if (this.finished || !url) return;
    const session = sessionFromURL(url);
    if (session) this.complete(session);
  }

  startWatching() {
    clearInterval(this.watcher);
    this.watcher = setInterval(() => {
      for (const wc of this.contents) {
        if (!wc.isDestroyed()) this.consume(wc.getURL());
      }
      this.finishIfLoggedIn();
    }, 1000);
  }

  async finishIfLoggedIn() {
    if (this.finished || this.finishing || !this.isOpen()) return;
    const cookies = await electronSession.fromPartition(PARTITION).cookies.get({});
    const loggedIn = cookies.some((cookie) => {
      const domain = (cookie.domain || '').toLowerCase();
      return cookie.name.includes('remixsid')
        && cookie.value.length > 10
        && (domain.includes('vk.com') || domain.includes('vk.ru'));
    });
    if (!loggedIn || this.finished || this.finishing || !this.isOpen()) return;
    if (!looksLoggedIn(this.window.webContents.getURL())) return;
    this.completeFromCookies();
  }

  completeFromCookies() {
    if (this.finished || this.finishing) return;
    this.finishing = true;
    this.onStatus?.('Вход есть, открываем библиотеку…');
    this.complete({
      token: `pending-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
      userId: 0,
      userAgent: MusicClient.userAgent
    });
  }

  complete(session) {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.watcher);
    this.watcher = null;
    this.onSession?.(session);
    this.dismiss();
  }
}

module.exports = { VKLoginWindow, sessionFromURL, looksLoggedIn };
