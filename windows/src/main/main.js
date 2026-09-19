'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, nativeImage, session, shell } = require('electron');
const { MusicClient, setBrowserUserAgent } = require('./constants');
const settings = require('./settings');
const { log } = require('./log');

const args = process.argv.slice(1);
const isSmoke = args.includes('--smoke-test');
const isRealSmoke = args.includes('--smoke-real');
const isDemo = args.includes('--demo') || args.includes('--demo-login') || isSmoke || Boolean(process.env.FENURA_DEMO);
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

const THEMES = {
  dark: { color: '#160A27', symbol: '#F4ECFF', background: '#12081F' },
  light: { color: '#EFF0EF', symbol: '#1A1A1A', background: '#F6F1EA' }
};

let mainWindow = null;
let service = null;
let store = null;
let login = null;

const gotLock = isDemo || isRealSmoke || app.requestSingleInstanceLock();
if (!gotLock) {
  // Уже запущена другая копия: она сама выйдет на передний план (см. second-instance).
  app.quit();
}

if (isDemo || isRealSmoke) {
  app.setPath('userData', path.join(app.getPath('temp'), `fenura-${isRealSmoke ? 'real' : 'demo'}-${process.pid}`));
}

app.setAppUserModelId('com.fenura.app');
// Плавный старт: не ждём, пока GPU-процесс проверит редкие функции, и не душим скрытые окна.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

process.on('uncaughtException', (error) => log('uncaughtException', error));
process.on('unhandledRejection', (error) => log('unhandledRejection', error instanceof Error ? error : String(error)));

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function applyTheme(isDark) {
  const theme = isDark ? THEMES.dark : THEMES.light;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(theme.background);
  if (isWin && typeof mainWindow.setTitleBarOverlay === 'function') {
    mainWindow.setTitleBarOverlay({ color: theme.color, symbolColor: theme.symbol, height: 40 });
  }
}

function createWindow() {
  const saved = settings.read();
  const theme = saved.isDark ? THEMES.dark : THEMES.light;
  const bounds = saved.bounds || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1100,
    height: bounds.height || 680,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1057,
    minHeight: 525,
    show: false,
    title: 'Fenura',
    icon: ICON,
    backgroundColor: theme.background,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    titleBarOverlay: isWin ? { color: theme.color, symbolColor: theme.symbol, height: 40 } : undefined,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
      additionalArguments: [
        `--fenura-platform=${process.platform}`,
        `--fenura-demo=${isDemo ? 1 : 0}`,
        `--fenura-test=${isSmoke || isRealSmoke ? 1 : 0}`
      ]
    }
  });

  if (saved.maximized) mainWindow.maximize();
  // Окно показываем по первому кадру, но не зависим от него: если событие не придёт, покажем по загрузке страницы
  // или по таймеру, чтобы окно не осталось невидимым при живом процессе.
  const reveal = (reason) => {
    if (isSmoke || !mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      log('main window shown by', reason);
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
  };
  mainWindow.once('ready-to-show', () => {
    log('main window ready-to-show');
    reveal('ready-to-show');
  });
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => reveal('did-finish-load'), 400));
  setTimeout(() => reveal('timer'), 3000).unref();
  mainWindow.webContents.on('did-finish-load', () => log('main window did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (_e, code, description) => log('main window did-fail-load', code, description));
  mainWindow.webContents.on('render-process-gone', (_e, details) => log('render-process-gone', details));
  mainWindow.webContents.on('unresponsive', () => log('main window unresponsive'));
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log('renderer console', level, message, source + ':' + line);
  });
  mainWindow.on('close', () => {
    if (mainWindow.isMinimized()) return;
    const maximized = mainWindow.isMaximized();
    settings.update({ maximized, bounds: maximized ? saved.bounds : mainWindow.getBounds() });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Скрытые окна моста и входа не должны держать приложение живым.
    app.quit();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  mainWindow.loadFile(INDEX);
}

function buildService() {
  if (isDemo) {
    const { DemoService } = require('./demo-service');
    return new DemoService({ loggedIn: !args.includes('--demo-login') });
  }
  const { VKAPI } = require('./vk-api');
  const { SessionStore } = require('./session-store');
  const { MusicService } = require('./service');
  const { VKLoginWindow } = require('./login-window');
  const { installAudioHeaders } = require('./headers');

  const api = new VKAPI();
  store = new SessionStore(api);
  login = new VKLoginWindow({ icon: nativeImage.createFromPath(ICON) });
  login.onStatus = (text) => send('login:status', text);
  login.onSession = (vk) => {
    send('login:status', 'Открываем библиотеку');
    store.finishOAuth(vk);
  };
  store.on('change', (snapshot) => send('session:changed', snapshot));
  installAudioHeaders(session.defaultSession, () => store.session?.cookieHeader || '');
  return new MusicService(store, api);
}

// Ответ всегда приходит конвертом, чтобы текст ошибки VK дошёл до интерфейса без приставок Electron.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...params) => {
    try {
      return { ok: true, value: await fn(...params) };
    } catch (error) {
      return { ok: false, error: (error && error.message) || String(error) };
    }
  });
}

function registerIpc() {
  handle('app:init', () => {
    const saved = settings.read();
    return {
      session: service.snapshot(),
      isDark: saved.isDark,
      volume: saved.volume,
      platform: process.platform,
      demo: isDemo,
      version: app.getVersion()
    };
  });
  handle('session:login', () => {
    if (service.demo) return service.login();
    login.present();
    return undefined;
  });
  handle('session:prepare', () => service.prepare());
  handle('session:logout', () => service.logout());

  handle('music:my', () => service.my());
  handle('music:playlist', (playlist) => service.playlist(playlist));
  handle('music:recommendations', (force) => service.recommendations(force));
  handle('music:popular', () => service.popular());
  handle('music:playlists', () => service.playlists());
  handle('music:search', (query) => service.search(query));
  handle('music:resolve', (track, force) => service.resolve(track, force));
  handle('music:prefetch', (tracks) => service.prefetch(tracks));
  handle('music:add', (track) => service.add(track));
  handle('music:remove', (track) => service.remove(track));
  handle('music:dropCache', (key) => service.dropCache(key));
  handle('art:color', (url) => service.color(url));

  handle('ui:theme', (isDark) => {
    settings.update({ isDark });
    applyTheme(isDark);
  });
  handle('ui:volume', (volume) => {
    settings.update({ volume });
  });
  handle('ui:trackMenu', ({ added }) => new Promise((resolve) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Слушать', click: () => resolve('play') },
      { label: added ? 'Убрать из моей музыки' : 'Добавить в мою музыку', click: () => resolve('toggle') }
    ]);
    menu.popup({ window: mainWindow, callback: () => setTimeout(() => resolve(null), 0) });
  }));
  handle('app:ready', (report) => {
    if (isSmoke) require('./test-driver').run(mainWindow, report, args, service);
    if (isRealSmoke) require('./real-driver').run({ getWindow: () => mainWindow, login, store, report, args });
  });
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]));
}

app.on('second-instance', () => {
  log('second instance requested');
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  log('app ready', app.getVersion(), process.platform, process.versions.electron);
  setBrowserUserAgent(session.defaultSession.getUserAgent());
  session.defaultSession.setUserAgent(MusicClient.userAgent);
  buildMenu();
  service = buildService();
  if (service.demo) {
    service.on('change', (snapshot) => send('session:changed', snapshot));
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (service) service.close();
});
