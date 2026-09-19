'use strict';

// Автопроверка сборки (`Fenura.exe --smoke-test --out=папка`): открывает демо-режим, проходит по основным
// сценариям, делает скриншоты и пишет report.json. Запускается в CI на Windows после сборки установщика.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

let started = false;

function option(args, name) {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(win, report, args, service) {
  if (started) return;
  started = true;
  const out = option(args, '--out') || path.join(os.tmpdir(), 'fenura-smoke');
  fs.mkdirSync(out, { recursive: true });
  const checks = { startup: report };
  const wc = win.webContents;
  const exec = (code) => wc.executeJavaScript(code, true);

  const until = async (label, code, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      let value = false;
      try {
        value = await exec(code);
      } catch {
        value = false;
      }
      if (value) return true;
      await wait(120);
    }
    checks[`timeout:${label}`] = true;
    return false;
  };

  const shot = async (name) => {
    await wait(350);
    const image = await wc.capturePage();
    fs.writeFileSync(path.join(out, name), image.toPNG());
  };

  const finish = (ok) => {
    checks.ok = ok;
    checks.platform = process.platform;
    checks.electron = process.versions.electron;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(checks, null, 2));
    setTimeout(() => app.exit(ok ? 0 : 1), 200);
  };

  setTimeout(() => finish(false), 90_000).unref();

  try {
    win.setSize(1100, 680);
    win.showInactive();
    await wait(600);

    if (args.includes('--demo-login')) {
      await shot('login.png');
      checks.loginScreen = await exec("Boolean(document.querySelector('.login-card'))");
      await exec("document.querySelector('.login-card .pill').click()");
    }

    checks.library = await until('library', "document.querySelectorAll('.row').length > 0");
    await until('playlists', "document.querySelectorAll('.side-playlists .nav-row').length > 0");
    await wait(400);
    await shot('library-dark.png');

    // Воспроизведение: реальный <audio> с сгенерированной мелодией.
    await exec("document.querySelector('.row').click()");
    checks.playback = await until('playback', 'window.__fenura.player.currentTime > 0.6 && window.__fenura.player.isPlaying');
    checks.mediaSession = await exec("Boolean(navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title)");
    checks.rowHighlighted = await exec("Boolean(document.querySelector('.row.current.playing'))");

    await exec('window.__fenura.player.toggle()');
    await wait(300);
    checks.pause = await exec('window.__fenura.player.isPlaying === false && window.__fenura.player.audio.paused === true');
    await exec('window.__fenura.player.toggle()');
    await wait(500);
    checks.resume = await exec('window.__fenura.player.isPlaying === true && window.__fenura.player.audio.paused === false');

    const before = await exec('window.__fenura.player.current.id');
    await exec('window.__fenura.player.next()');
    checks.next = await until('next', `window.__fenura.player.current.id !== ${JSON.stringify(before)} && window.__fenura.player.currentTime > 0.4`);

    await exec('window.__fenura.player.seek(12)');
    await wait(400);
    checks.seek = await exec('Math.abs(window.__fenura.player.audio.currentTime - 12) < 2');

    await exec('window.__fenura.player.setVolume(0.4)');
    checks.volume = await exec('Math.abs(window.__fenura.player.audio.volume - 0.4) < 0.01');

    await wait(600);
    await shot('playing-dark.png');

    await exec('window.__fenura.store.toggleTheme()');
    await wait(900);
    checks.themeLight = await exec("document.documentElement.dataset.theme === 'light'");
    await shot('playing-light.png');
    await exec('window.__fenura.store.toggleTheme()');
    await wait(600);

    await exec("window.__fenura.store.open({ type: 'rec' })");
    await until('rec', "document.querySelectorAll('.row').length > 0");
    await shot('recommendations-dark.png');

    await exec("window.__fenura.store.open({ type: 'search' })");
    await wait(300);
    await exec("(async () => { const s = window.__fenura.store; s.query = 'lu'; await s.runSearch(); })()");
    await wait(300);
    checks.search = await exec('window.__fenura.store.search.tracks.length > 0');
    await shot('search-dark.png');

    await exec("window.__fenura.store.open({ type: 'playlist', playlist: window.__fenura.store.playlists[0] })");
    await until('playlist', "document.querySelectorAll('.row').length > 0");
    checks.playlist = await exec("Boolean(document.querySelector('.hero'))");
    await shot('playlist-dark.png');

    const liked = await exec(`(async () => {
      const s = window.__fenura.store;
      const track = s.tracks[0];
      const was = s.addedIds.has(track.id);
      await s.toggleLike(track);
      return s.addedIds.has(track.id) !== was;
    })()`);
    checks.like = liked;

    if (args.includes('--demo-login')) {
      await exec("window.__fenura.store.logout()");
      checks.logout = await until('logout', "Boolean(document.querySelector('.login-card'))");
    }

    const failed = Object.entries(checks).filter(([key, value]) => (key.startsWith('timeout:') && value) || value === false);
    finish(failed.length === 0 && Boolean(report.hls) && Boolean(report.fonts));
  } catch (error) {
    checks.error = String(error && error.stack ? error.stack : error);
    finish(false);
  }
  void service;
}

module.exports = { run };
