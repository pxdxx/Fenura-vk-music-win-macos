import { Bus } from './bus.js';

// Порт AppModel.swift: разделы, поиск, кэш разделов, лайки.

const CACHE_KEY = 'fenura.library.v1';

export const sectionKey = (section) => {
  switch (section.type) {
    case 'my': return 'my';
    case 'rec': return 'rec';
    case 'pop': return 'pop';
    case 'search': return 'search';
    default: return `pl:${section.playlist.id}`;
  }
};

export const sameSection = (a, b) => sectionKey(a) === sectionKey(b);

export class Store extends Bus {
  constructor(api, player) {
    super();
    this.api = api;
    this.player = player;
    this.session = { loggedIn: false, profile: null, busy: false, error: null, official: false };
    this.section = { type: 'my' };
    this.tracks = [];
    this.playlists = [];
    this.search = { tracks: [], playlists: [] };
    this.query = '';
    this.isLoading = false;
    this.isRefreshing = false;
    this.notice = null;
    this.addedIds = new Set();
    this.isDark = true;
    this.sectionCache = new Map();
    this.openSeq = 0;
    this.searchSeq = 0;
    this.booted = false;
  }

  get title() {
    switch (this.section.type) {
      case 'my': return 'Моя музыка';
      case 'rec': return 'Для вас';
      case 'pop': return 'Популярное';
      case 'search': return this.query ? this.query : 'Поиск';
      default: return this.section.playlist.title;
    }
  }

  get subtitle() {
    switch (this.section.type) {
      case 'my': return `${this.tracks.length} ${plural(this.tracks.length, 'трек', 'трека', 'треков')} в вашей библиотеке`;
      case 'rec': return 'Подборка по тому, что вы слушаете';
      case 'pop': return 'Что сейчас крутят во ВКонтакте';
      case 'search':
        return this.query
          ? `${this.search.tracks.length} ${plural(this.search.tracks.length, 'трек', 'трека', 'треков')} · ${this.search.playlists.length} ${plural(this.search.playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}`
          : 'Найдите трек, исполнителя или плейлист';
      default: return `${this.section.playlist.count} ${plural(this.section.playlist.count, 'трек', 'трека', 'треков')}`;
    }
  }

  setTheme(isDark) {
    this.isDark = isDark;
    this.emit('theme');
  }

  toggleTheme() {
    this.setTheme(!this.isDark);
    this.api.setTheme(this.isDark).catch(() => undefined);
  }

  setSession(next) {
    const wasLoggedIn = this.session.loggedIn;
    this.session = next;
    this.emit('session');
    if (next.loggedIn && !wasLoggedIn) {
      this.bootstrap();
    } else if (!next.loggedIn && wasLoggedIn) {
      this.reset();
    }
  }

  async bootstrap() {
    if (!this.session.loggedIn) return;
    this.restoreCache();
    let snapshot = this.session;
    try {
      snapshot = await this.api.prepare();
      this.session = snapshot;
      this.emit('session');
    } catch {
      // Продолжаем с тем, что есть: ошибка придёт при первом запросе.
    }
    if (!snapshot.official && snapshot.error) {
      this.notice = snapshot.error;
      this.emit('notice');
    }
    await Promise.all([this.open({ type: 'my' }), this.refreshPlaylists()]);
    this.prefetchNeighbors();
  }

  async open(next, force = false) {
    const seq = ++this.openSeq;
    this.section = next;
    this.notice = null;
    const key = sectionKey(next);
    const cached = this.sectionCache.get(key);

    if (next.type === 'search') {
      this.isLoading = false;
      this.tracks = this.search.tracks;
      this.emit('section');
      return;
    }

    if (cached && cached.length) {
      this.tracks = cached;
      this.isLoading = false;
    } else {
      this.tracks = [];
      this.isLoading = true;
    }
    this.emit('section');
    if (!this.session.loggedIn) {
      this.isLoading = false;
      this.emit('tracks');
      return;
    }

    try {
      let fresh;
      switch (next.type) {
        case 'my':
          fresh = await this.api.my();
          this.addedIds = new Set(fresh.map((track) => track.id));
          break;
        case 'rec':
          fresh = await this.api.recommendations(force);
          break;
        case 'pop':
          fresh = await this.api.popular();
          break;
        default:
          fresh = await this.api.playlist(next.playlist);
      }
      fresh = this.markAdded(fresh);
      if (fresh.length) this.sectionCache.set(key, fresh);
      if (next.type === 'my') this.saveCache(fresh);
      if (seq !== this.openSeq) return;
      this.tracks = fresh;
    } catch (error) {
      if (seq === this.openSeq && this.tracks.length === 0) {
        this.notice = error.message;
      }
    }
    if (seq !== this.openSeq) return;
    this.isLoading = false;
    this.emit('tracks');
    this.emit('notice');
  }

  async refreshPlaylists() {
    try {
      this.playlists = await this.api.playlists();
    } catch {
      this.playlists = [];
    }
    this.emit('playlists');
    this.saveCache();
  }

  prefetchNeighbors() {
    (async () => {
      try {
        const tracks = await this.api.recommendations(false);
        if (tracks.length) this.sectionCache.set('rec', this.markAdded(tracks));
      } catch {
        // Подборка подгрузится при открытии раздела.
      }
      try {
        const tracks = await this.api.popular();
        if (tracks.length) this.sectionCache.set('pop', this.markAdded(tracks));
      } catch {
        // Так же.
      }
    })();
  }

  async runSearch() {
    const text = this.query.trim();
    const seq = ++this.searchSeq;
    this.section = { type: 'search' };
    if (!this.session.loggedIn || text.length < 2) {
      this.search = { tracks: [], playlists: [] };
      this.tracks = [];
      this.isLoading = false;
      this.emit('search');
      return;
    }
    this.isLoading = true;
    this.emit('search');
    try {
      const found = await this.api.search(text);
      if (seq !== this.searchSeq) return;
      const bundle = { tracks: this.markAdded(found.tracks), playlists: found.playlists };
      this.search = bundle;
      this.tracks = bundle.tracks;
      this.notice = null;
    } catch (error) {
      if (seq !== this.searchSeq) return;
      this.notice = error.message;
    }
    this.isLoading = false;
    this.emit('search');
  }

  async refreshRecommendations() {
    if (!this.session.loggedIn) return;
    this.isRefreshing = true;
    this.notice = null;
    this.emit('section');
    await this.api.dropCache('rec').catch(() => undefined);
    await this.open({ type: 'rec' }, true);
    this.isRefreshing = false;
    if (this.tracks.length === 0) this.notice = 'Не удалось обновить подборку. Попробуйте ещё раз.';
    this.emit('section');
    this.emit('notice');
  }

  play(track, list) {
    this.player.play(track, list || this.tracks);
  }

  async toggleLike(track) {
    try {
      if (this.addedIds.has(track.id)) {
        await this.api.remove(track);
        this.addedIds.delete(track.id);
      } else {
        await this.api.add(track);
        this.addedIds.add(track.id);
      }
      const added = this.addedIds.has(track.id);
      for (const list of [this.tracks, this.search.tracks, ...this.sectionCache.values()]) {
        const found = list.find((item) => item.id === track.id);
        if (found) found.isAdded = added;
      }
      this.player.replaceCurrent({ ...track, isAdded: added });
      this.emit('added', track.id);
    } catch (error) {
      this.notice = error.message;
      this.emit('notice');
    }
  }

  async logout() {
    this.player.stop();
    try {
      await this.api.logout();
    } catch {
      // Локальное состояние всё равно сбрасываем.
    }
    this.session = { loggedIn: false, profile: null, busy: false, error: null, official: false };
    this.reset();
    this.emit('session');
  }

  reset() {
    this.player.stop();
    this.tracks = [];
    this.playlists = [];
    this.search = { tracks: [], playlists: [] };
    this.query = '';
    this.addedIds = new Set();
    this.sectionCache = new Map();
    this.section = { type: 'my' };
    this.notice = null;
    this.isLoading = false;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // Хранилище недоступно.
    }
    this.emit('section');
    this.emit('playlists');
  }

  markAdded(list) {
    for (const track of list) track.isAdded = this.addedIds.has(track.id);
    return list;
  }

  // Последняя библиотека показывается сразу при запуске, пока идёт обновление из сети.
  restoreCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const owner = this.session.profile?.id;
      if (!raw || raw.owner !== owner) return;
      if (raw.tracks?.length) {
        this.addedIds = new Set(raw.tracks.map((track) => track.id));
        const tracks = this.markAdded(raw.tracks);
        this.sectionCache.set('my', tracks);
        this.tracks = tracks;
      }
      if (raw.playlists?.length) {
        this.playlists = raw.playlists;
        this.emit('playlists');
      }
      this.emit('section');
    } catch {
      // Кэш повреждён, игнорируем.
    }
  }

  saveCache(tracks) {
    try {
      const previous = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') || {};
      const payload = {
        owner: this.session.profile?.id,
        tracks: tracks
          ? tracks.map(({ url, ...rest }) => ({ ...rest, url: '' }))
          : previous.tracks || [],
        playlists: this.playlists.length ? this.playlists : previous.playlists || []
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Не критично.
    }
  }
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
