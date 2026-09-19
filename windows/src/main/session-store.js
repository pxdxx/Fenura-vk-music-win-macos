'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app, safeStorage, session: electronSession } = require('electron');
const { PARTITION, MusicClient } = require('./constants');
const { VKAPI } = require('./vk-api');
const { sleep } = require('./util');
const { log } = require('./log');

const FILE = 'session.bin';

function vkSession() {
  return electronSession.fromPartition(PARTITION);
}

async function harvestCookies() {
  const cookies = await vkSession().cookies.get({});
  const useful = cookies.filter((cookie) => {
    const domain = (cookie.domain || '').toLowerCase();
    return domain.includes('vk.com') || domain.includes('vk.ru');
  });
  const hasSession = useful.some((cookie) => cookie.name.includes('remixsid') && cookie.value.length > 10);
  if (!hasSession) return null;
  return useful.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function harvestWithRetry() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const header = await harvestCookies();
    if (header) return header;
    await sleep(250);
  }
  return null;
}

async function clearCookies() {
  const ses = vkSession();
  await ses.clearStorageData();
  await ses.clearCache();
}

// Хранит вход в VK. Токен и куки шифруются средствами ОС (DPAPI на Windows, Keychain на macOS).
class SessionStore extends EventEmitter {
  constructor(api = new VKAPI()) {
    super();
    this.api = api;
    this.session = null;
    this.profile = null;
    this.isBusy = false;
    this.errorMessage = null;
    this.api.onSessionRefreshed = (fresh) => this.adopt(fresh);
    this.restore();
  }

  get isLoggedIn() {
    return this.session !== null;
  }

  snapshot() {
    return {
      loggedIn: this.isLoggedIn,
      profile: this.profile,
      busy: this.isBusy,
      error: this.errorMessage,
      official: Boolean(this.session && this.session.token.startsWith('vk1.'))
    };
  }

  notify() {
    this.emit('change', this.snapshot());
  }

  async finishOAuth(next) {
    this.isBusy = true;
    this.errorMessage = null;
    this.notify();
    try {
      let working = { ...next };
      working.cookieHeader = (await harvestWithRetry()) || working.cookieHeader;
      log('finishOAuth: cookies', working.cookieHeader ? 'found' : 'missing');
      working = await this.api.resolveMusicSession(working);
      log('finishOAuth: music token received');
      let user;
      try {
        user = await this.api.profile(working);
      } catch {
        user = { id: working.userId, firstName: 'VK', lastName: '', photoURL: null };
      }
      this.session = working;
      this.profile = user;
      this.persist();
      log('finishOAuth: session saved');
    } catch (error) {
      log('finishOAuth failed', error.message);
      this.errorMessage = error.message;
    } finally {
      this.isBusy = false;
      this.notify();
    }
  }

  async prepareAudioSession() {
    if (!this.session) return;
    const current = { ...this.session };
    if (!current.cookieHeader) current.cookieHeader = await harvestWithRetry();
    try {
      const upgraded = await this.api.resolveMusicSession(current);
      const changed = JSON.stringify(upgraded) !== JSON.stringify(this.session);
      this.session = upgraded;
      if (changed) {
        try {
          this.profile = await this.api.profile(upgraded);
        } catch {
          // Оставляем прежний профиль.
        }
        this.persist();
      }
      if (upgraded.token.startsWith('vk1.')) this.errorMessage = null;
    } catch (error) {
      log('prepareAudioSession failed', error.message);
      this.errorMessage = error.message;
    }
    this.notify();
  }

  // Обновлённый токен музыки подхватываем сразу, чтобы не запрашивать его заново при каждом вызове API.
  adopt(fresh) {
    if (!this.session || fresh.token === this.session.token) return;
    this.session = fresh;
    this.persist();
  }

  clearError() {
    this.errorMessage = null;
  }

  async logout() {
    this.session = null;
    this.profile = null;
    this.errorMessage = null;
    this.api.clearCaches();
    this.deleteStored();
    this.notify();
    await clearCookies();
  }

  // ---- Хранилище ----

  filePath() {
    return path.join(app.getPath('userData'), FILE);
  }

  persist() {
    if (!this.session || !this.profile) return;
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const data = JSON.stringify({ session: this.session, profile: this.profile });
      fs.writeFileSync(this.filePath(), safeStorage.encryptString(data));
    } catch {
      // Без сохранения вход просто не переживёт перезапуск.
    }
  }

  restore() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const raw = fs.readFileSync(this.filePath());
      const stored = JSON.parse(safeStorage.decryptString(raw));
      if (stored && stored.session && stored.profile) {
        if (!stored.session.userAgent) stored.session.userAgent = MusicClient.userAgent;
        this.session = stored.session;
        this.profile = stored.profile;
      }
    } catch {
      // Нет сохранённого входа.
    }
  }

  deleteStored() {
    try {
      fs.rmSync(this.filePath(), { force: true });
    } catch {
      // Файла может не быть.
    }
  }
}

module.exports = { SessionStore, harvestCookies, clearCookies, vkSession };
