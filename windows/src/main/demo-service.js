'use strict';

// Демо-режим: те же вызовы, что у MusicService, но без ВКонтакте и без входа.
// Нужен для разработки, скриншотов и автоматической проверки сборки.

const { EventEmitter } = require('events');

const ARTISTS = [
  ['Luna Vale', 'Neon Harbor'], ['Kite & Ember', 'Glass Summer'], ['Marlo Quinn', 'Paper Planes at Dawn'],
  ['The Velvet Orbit', 'Slow Motion Heart'], ['Ivy Rowan', 'Golden Hour Radio'], ['Nightbloom', 'Afterglow Avenue'],
  ['Sora Hale', 'Lanterns'], ['Echo Meridian', 'Static Bloom'], ['Pale Coast', 'Tidal Dreams'],
  ['Juno Ash', 'Midnight Transit'], ['Cove & Canyon', 'Wildflower Signal'], ['Rhea North', 'Skyline Lullaby'],
  ['Oriel', 'Quiet Constellations'], ['Mint Season', 'Cherry Static'], ['Hollow Pines', 'Northern Lights Club'],
  ['Tavi Moon', 'Velvet Rain'], ['Auric', 'Chasing Daylight'], ['Nova Lane', 'Polaroid Summer'],
  ['Wren Eastman', 'Small Talk in Paris'], ['Solstice Club', 'Sunday Drive'], ['Faye Marlowe', 'Blue Hour'],
  ['Dune Parade', 'Mirage'], ['Coral Fields', 'Heartbeat Boulevard'], ['Ash & Aster', 'Lowlight']
];

const PLAYLISTS = [
  ['Утро без спешки', 'Спокойный старт дня'], ['Для работы', 'Фокус и тишина'], ['Дорога', 'Музыка в пути'],
  ['Вечерний джаз', 'Мягкий свет и пластинки'], ['Спорт', 'Ритм на весь час']
];

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function artwork(seed, colors) {
  const h1 = (seed * 47) % 360;
  const h2 = (h1 + 55) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},82%,62%)"/><stop offset="1" stop-color="hsl(${h2},78%,42%)"/></linearGradient></defs>
<rect width="200" height="200" fill="url(#g)"/><circle cx="${60 + (seed % 5) * 20}" cy="${70 + (seed % 3) * 25}" r="${38 + (seed % 4) * 8}" fill="#fff" fill-opacity="0.16"/>
<circle cx="150" cy="150" r="46" fill="#000" fill-opacity="0.12"/></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  colors.set(url, hslToRgb(h1, 0.7, 0.5));
  return url;
}

// Короткая мелодия в виде WAV: чтобы плеер, полоса прогресса и MediaSession работали по-настоящему.
function melody(seed) {
  const rate = 8000;
  const seconds = 40;
  const notes = [261.63, 329.63, 392, 493.88, 440, 349.23, 293.66, 392];
  const count = rate * seconds;
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + count * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const step = Math.floor(t / 0.5);
    const freq = notes[(step + seed) % notes.length];
    const local = (t % 0.5) / 0.5;
    const envelope = Math.min(1, local * 12) * Math.exp(-local * 2.2);
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.16 * envelope;
    data.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return `data:audio/wav;base64,${data.toString('base64')}`;
}

class DemoService extends EventEmitter {
  constructor({ loggedIn = true } = {}) {
    super();
    this.demo = true;
    this.colors = new Map();
    this.loggedIn = loggedIn;
    this.tracks = ARTISTS.map(([artist, title], index) => ({
      id: `1_${100 + index}`,
      ownerId: 1,
      audioId: 100 + index,
      artist,
      title,
      duration: 150 + ((index * 37) % 120),
      url: '',
      artworkURL: artwork(index + 1, this.colors),
      accessKey: null,
      isAdded: false
    }));
    this.mine = new Set(this.tracks.slice(0, 16).map((track) => track.id));
    this.hlsURL = process.env.FENURA_DEMO_HLS || '';
    this.profile = {
      id: 1,
      firstName: 'Алекс',
      lastName: 'Демо',
      photoURL: artwork(9, this.colors)
    };
  }

  snapshot() {
    return {
      loggedIn: this.loggedIn,
      profile: this.loggedIn ? this.profile : null,
      busy: false,
      error: null,
      official: true
    };
  }

  login() {
    setTimeout(() => {
      this.loggedIn = true;
      this.emit('change', this.snapshot());
    }, 500);
  }

  async prepare() {
    return this.snapshot();
  }

  async logout() {
    this.loggedIn = false;
    this.emit('change', this.snapshot());
  }

  marked(list) {
    return list.map((track) => ({ ...track, isAdded: this.mine.has(track.id) }));
  }

  async my() {
    return this.marked(this.tracks.filter((track) => this.mine.has(track.id)));
  }

  async playlist(playlist) {
    const start = Number(playlist.playlistId) % 6;
    return this.marked(this.tracks.slice(start, start + 9));
  }

  async recommendations(force) {
    const list = force ? [...this.tracks].reverse() : this.tracks.slice(6, 22);
    return this.marked(list.slice(0, 16));
  }

  async popular() {
    return this.marked(this.tracks.slice(2, 20));
  }

  async playlists() {
    return PLAYLISTS.map(([title, subtitle], index) => ({
      id: `1_${index + 1}`,
      ownerId: 1,
      playlistId: index + 1,
      title,
      subtitle,
      count: 9,
      artworkURL: artwork(20 + index, this.colors),
      accessKey: null
    }));
  }

  async search(query) {
    const q = query.toLowerCase();
    const tracks = this.tracks.filter((track) => `${track.artist} ${track.title}`.toLowerCase().includes(q));
    const playlists = (await this.playlists()).filter((playlist) => playlist.title.toLowerCase().includes(q));
    return { tracks: this.marked(tracks), playlists };
  }

  async resolve(track) {
    if (this.hlsURL) return this.hlsURL;
    const seed = Number(track.audioId) % 7;
    return melody(seed);
  }

  prefetch() {}

  async add(track) {
    this.mine.add(track.id);
  }

  async remove(track) {
    this.mine.delete(track.id);
  }

  dropCache() {}

  async color(url) {
    return this.colors.get(url) || null;
  }

  close() {}
}

module.exports = { DemoService };
