import { Bus } from './bus.js';
import { sleep } from './dom.js';

// Порт PlayerService.swift: очередь, shuffle/repeat, восстановление после сбоев, Now Playing.
// Вместо AVPlayer используется <audio> и hls.js: ВКонтакте отдаёт треки в HLS.

const START_WATCHDOG_MS = 4500;

export class Player extends Bus {
  constructor(api) {
    super();
    this.api = api;
    this.current = null;
    this.queue = [];
    this.origin = [];
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 0.85;
    this.shuffle = false;
    this.repeatMode = 'off';
    this.isBuffering = false;
    this.lastError = null;
    this.ambient = null;

    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.hls = null;
    this.generation = 0;
    this.isRecovering = false;
    this.switching = false;
    this.watchdog = null;
    this.lastPosition = 0;
    this.attempt = 0;
    this.pendingSeek = 0;

    this.bindAudio();
    this.bindMediaSession();
  }

  // ---- Управление ----

  play(track, tracks) {
    this.origin = tracks;
    let queue = this.shuffle ? shuffled(tracks) : [...tracks];
    const index = queue.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      queue = [...queue.slice(index), ...queue.slice(0, index)];
    } else {
      queue.unshift(track);
    }
    this.queue = queue;
    this.emit('queue');
    this.start(track);
  }

  toggle() {
    if (!this.current && this.queue.length) {
      this.start(this.queue[0]);
      return;
    }
    if (!this.current) return;
    if (this.isPlaying) this.pause();
    else this.resume();
  }

  pause() {
    this.audio.pause();
    this.setPlaying(false);
  }

  resume() {
    if (!this.current) return;
    const result = this.audio.play();
    if (result && result.catch) result.catch(() => undefined);
    this.setPlaying(true);
  }

  next() {
    if (!this.current) return;
    const index = this.queue.findIndex((item) => item.id === this.current.id);
    if (index < 0) return;
    if (index + 1 < this.queue.length) {
      this.start(this.queue[index + 1]);
    } else if (this.repeatMode === 'all' && this.queue.length) {
      this.start(this.queue[0]);
    } else {
      this.pause();
      this.seek(0);
    }
  }

  previous() {
    if (!this.current) return;
    if (this.currentTime > 3) {
      this.seek(0);
      return;
    }
    const index = this.queue.findIndex((item) => item.id === this.current.id);
    if (index > 0) this.start(this.queue[index - 1]);
    else this.seek(0);
  }

  seek(time) {
    if (!this.current) return;
    const limit = this.duration > 0 ? this.duration : time;
    const target = Math.min(Math.max(time, 0), limit);
    try {
      this.audio.currentTime = target;
    } catch {
      // Источник ещё не готов, позиция применится после загрузки.
    }
    this.currentTime = target;
    this.emit('time');
    this.syncPosition();
  }

  setVolume(value) {
    this.volume = Math.min(Math.max(value, 0), 1);
    this.audio.volume = this.volume;
    this.emit('volume');
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.current) {
      if (this.shuffle) {
        const rest = shuffled(this.origin.filter((item) => item.id !== this.current.id));
        this.queue = [this.current, ...rest];
      } else {
        this.queue = [...this.origin];
      }
    }
    this.emit('modes');
  }

  cycleRepeat() {
    this.repeatMode = this.repeatMode === 'off' ? 'all' : this.repeatMode === 'all' ? 'one' : 'off';
    this.emit('modes');
  }

  replaceCurrent(track) {
    if (this.current && this.current.id === track.id) {
      this.current = track;
    }
    const swap = (list) => {
      const index = list.findIndex((item) => item.id === track.id);
      if (index >= 0) list[index] = track;
    };
    swap(this.queue);
    swap(this.origin);
  }

  stop() {
    this.generation += 1;
    this.teardown();
    this.current = null;
    this.queue = [];
    this.origin = [];
    this.currentTime = 0;
    this.duration = 0;
    this.isBuffering = false;
    this.lastError = null;
    this.ambient = null;
    this.setPlaying(false);
    this.emit('track');
    this.emit('time');
    this.emit('ambient');
    this.clearMediaSession();
  }

  // ---- Запуск трека ----

  start(track) {
    this.current = track;
    this.isBuffering = true;
    this.lastError = null;
    this.isRecovering = false;
    this.pendingSeek = 0;
    this.currentTime = 0;
    this.duration = track.duration;
    this.generation += 1;
    const generation = this.generation;
    this.setPlaying(true);
    this.emit('track');
    this.emit('time');
    this.emit('buffering');
    this.updateMediaSession(track);
    this.extractAmbient(track.artworkURL, generation);
    this.beginPlayback(track, generation, 0).then(() => this.prefetchAround(track));
  }

  async beginPlayback(track, generation, attempt) {
    try {
      const url = await this.api.resolve(track, attempt > 0);
      if (generation !== this.generation) return;
      this.attach(url, track, generation, attempt);
    } catch {
      if (generation !== this.generation) return;
      if (attempt < 2) {
        await sleep(250);
        if (generation !== this.generation) return;
        await this.beginPlayback(track, generation, attempt + 1);
        return;
      }
      this.isBuffering = false;
      this.setPlaying(false);
      this.lastError = `Не удалось загрузить «${track.title}». Нажмите трек ещё раз.`;
      this.emit('buffering');
      this.emit('error');
    }
  }

  prefetchAround(track) {
    const index = this.queue.findIndex((item) => item.id === track.id);
    if (index < 0) return;
    const neighbors = this.queue.slice(index + 1, index + 3);
    if (neighbors.length) this.api.prefetch(neighbors).catch(() => undefined);
  }

  attach(url, track, generation, attempt) {
    if (!url) {
      this.isBuffering = false;
      this.emit('buffering');
      return;
    }
    this.teardown();
    this.switching = true;
    this.isRecovering = false;
    this.isBuffering = true;
    this.attempt = attempt;
    this.audio.volume = this.volume;
    const resumeAt = this.pendingSeek;

    const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes('/index.m3u8');
    if (isHls && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 40,
        maxMaxBufferLength: 90,
        backBufferLength: 20,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 300,
        startFragPrefetch: true,
        startPosition: resumeAt > 0 ? resumeAt : -1
      });
      this.hls = hls;
      let mediaRecovered = false;
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || generation !== this.generation) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        this.recover(track, generation, attempt, true);
      });
      hls.loadSource(url);
      hls.attachMedia(this.audio);
    } else {
      this.audio.src = url;
      if (resumeAt > 0) {
        this.audio.addEventListener('loadedmetadata', () => {
          this.audio.currentTime = resumeAt;
        }, { once: true });
      }
    }
    this.switching = false;

    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (generation === this.generation && this.currentTime < 0.4) {
        this.recover(track, generation, attempt, false);
      }
    }, START_WATCHDOG_MS);

    const result = this.audio.play();
    if (result && result.catch) result.catch(() => undefined);
    this.setPlaying(true);
    this.emit('buffering');
  }

  recover(track, generation, attempt, force) {
    if (generation !== this.generation) return;
    if (!force && this.currentTime >= 0.4) return;
    if (attempt < 2 && !this.isRecovering) {
      this.isRecovering = true;
      // Сбой посреди трека: берём свежую ссылку и продолжаем с того же места.
      this.pendingSeek = this.currentTime >= 0.4 ? this.currentTime : 0;
      this.beginPlayback(track, generation, attempt + 1);
      return;
    }
    if (this.isRecovering) return;
    this.isBuffering = false;
    this.setPlaying(false);
    this.lastError = 'Трек не запустился. Нажмите его ещё раз.';
    this.emit('buffering');
    this.emit('error');
  }

  handleEnd() {
    if (this.repeatMode === 'one') {
      this.seek(0);
      this.resume();
      return;
    }
    this.next();
  }

  teardown() {
    clearTimeout(this.watchdog);
    this.watchdog = null;
    this.switching = true;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.switching = false;
  }

  // ---- События <audio> ----

  bindAudio() {
    const audio = this.audio;
    audio.volume = this.volume;
    let lastEmit = 0;

    audio.addEventListener('timeupdate', () => {
      if (this.switching || !this.current) return;
      this.currentTime = audio.currentTime;
      if (Number.isFinite(audio.duration) && audio.duration > 0) this.duration = audio.duration;
      if (audio.currentTime > 0.15 && this.isBuffering) {
        this.isBuffering = false;
        this.emit('buffering');
      }
      const now = performance.now();
      if (now - lastEmit >= 200) {
        lastEmit = now;
        this.emit('time');
        if (Math.abs(this.currentTime - this.lastPosition) >= 1) this.syncPosition();
      }
    });
    audio.addEventListener('durationchange', () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.duration = audio.duration;
        this.emit('time');
      }
    });
    audio.addEventListener('playing', () => {
      if (this.switching) return;
      this.isBuffering = false;
      this.emit('buffering');
      this.setPlaying(true);
    });
    audio.addEventListener('waiting', () => {
      if (this.switching || !this.current) return;
      this.isBuffering = true;
      this.emit('buffering');
    });
    audio.addEventListener('pause', () => {
      // Пауза не от нас (гарнитура, системные клавиши): синхронизируем состояние.
      if (this.switching || audio.ended || !this.current) return;
      this.setPlaying(false);
    });
    audio.addEventListener('play', () => {
      if (this.switching || !this.current) return;
      this.setPlaying(true);
    });
    audio.addEventListener('ended', () => this.handleEnd());
    audio.addEventListener('error', () => {
      if (this.switching || !this.current || this.hls) return;
      this.recover(this.current, this.generation, this.attempt, true);
    });
  }

  setPlaying(value) {
    if (this.isPlaying === value) return;
    this.isPlaying = value;
    this.emit('playing');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = value ? 'playing' : 'paused';
    }
  }

  // ---- Системный плеер (SMTC, клавиши мультимедиа) ----

  bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const set = (action, handler) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Действие не поддерживается этой системой.
      }
    };
    set('play', () => this.resume());
    set('pause', () => this.pause());
    set('previoustrack', () => this.previous());
    set('nexttrack', () => this.next());
    set('seekto', (details) => {
      if (typeof details.seekTime === 'number') this.seek(details.seekTime);
    });
    set('seekbackward', (details) => this.seek(this.currentTime - (details.seekOffset || 10)));
    set('seekforward', (details) => this.seek(this.currentTime + (details.seekOffset || 10)));
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    const artwork = track.artworkURL && /^https?:/i.test(track.artworkURL)
      ? [{ src: track.artworkURL, sizes: '600x600' }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'Fenura',
      artwork
    });
  }

  clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }

  syncPosition() {
    this.lastPosition = this.currentTime;
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!(this.duration > 0) || !Number.isFinite(this.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        playbackRate: 1,
        position: Math.min(Math.max(this.currentTime, 0), this.duration)
      });
    } catch {
      // Значения вне диапазона, пропускаем.
    }
  }

  // ---- Цвет обложки ----

  async extractAmbient(url, generation) {
    if (!url) {
      this.ambient = null;
      this.emit('ambient');
      return;
    }
    try {
      const color = await this.api.color(url);
      if (generation !== this.generation) return;
      this.ambient = color;
    } catch {
      this.ambient = null;
    }
    this.emit('ambient');
  }
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
