'use strict';

const { apiError } = require('./errors');
const { averageColor } = require('./artwork');

// Слой между окном приложения и VK: соответствует AppModel.swift в части обращений к сети.
class MusicService {
  constructor(store, api) {
    this.store = store;
    this.api = api;
    this.demo = false;
  }

  snapshot() {
    return this.store.snapshot();
  }

  vk() {
    if (!this.store.session) throw apiError('Нужно войти во ВКонтакте');
    return this.store.session;
  }

  owner() {
    return this.store.profile?.id ?? this.vk().userId;
  }

  async prepare() {
    await this.store.prepareAudioSession();
    return this.store.snapshot();
  }

  async logout() {
    await this.store.logout();
  }

  my() {
    return this.api.audios(this.vk(), { ownerId: this.owner() });
  }

  playlist(playlist) {
    return this.api.audios(this.vk(), {
      ownerId: playlist.ownerId,
      playlistId: playlist.playlistId,
      accessKey: playlist.accessKey
    });
  }

  recommendations(force) {
    return this.api.recommendations(this.vk(), { force: Boolean(force) });
  }

  popular() {
    return this.api.popular(this.vk());
  }

  async playlists() {
    return this.api.playlists(this.vk(), this.owner());
  }

  async search(query) {
    const vk = this.vk();
    const [tracks, playlists] = await Promise.all([
      this.api.searchTracks(vk, query),
      this.api.searchPlaylists(vk, query).catch(() => [])
    ]);
    return { tracks, playlists };
  }

  resolve(track, force) {
    return this.api.resolveURL(this.vk(), track, Boolean(force));
  }

  prefetch(tracks) {
    this.api.prefetchURLs(this.vk(), tracks);
  }

  add(track) {
    return this.api.add(this.vk(), track);
  }

  remove(track) {
    return this.api.remove(this.vk(), track);
  }

  dropCache(key) {
    this.api.dropTrackCache(key);
  }

  color(url) {
    return averageColor(url);
  }

  close() {
    this.api.web.close();
  }
}

module.exports = { MusicService };
