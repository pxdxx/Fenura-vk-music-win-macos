'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const option = (name) => {
  const prefix = `--fenura-${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

async function call(channel, ...params) {
  const result = await ipcRenderer.invoke(channel, ...params);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function listen(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld('fenura', {
  platform: option('platform'),
  demo: option('demo') === '1',
  test: option('test') === '1',

  init: () => call('app:init'),
  ready: (report) => call('app:ready', report),

  login: () => call('session:login'),
  prepare: () => call('session:prepare'),
  logout: () => call('session:logout'),
  onSession: (callback) => listen('session:changed', callback),
  onLoginStatus: (callback) => listen('login:status', callback),

  my: () => call('music:my'),
  playlist: (playlist) => call('music:playlist', playlist),
  recommendations: (force) => call('music:recommendations', force),
  popular: () => call('music:popular'),
  playlists: () => call('music:playlists'),
  search: (query) => call('music:search', query),
  resolve: (track, force) => call('music:resolve', track, force),
  prefetch: (tracks) => call('music:prefetch', tracks),
  add: (track) => call('music:add', track),
  remove: (track) => call('music:remove', track),
  dropCache: (key) => call('music:dropCache', key),
  color: (url) => call('art:color', url),

  setTheme: (isDark) => call('ui:theme', isDark),
  setVolume: (volume) => call('ui:volume', volume),
  trackMenu: (added) => call('ui:trackMenu', { added })
});
