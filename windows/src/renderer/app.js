import { h } from './dom.js';
import { Player } from './player.js';
import { Store } from './store.js';
import { createLogin, createSidebar, createLibrary, createPlayerBar } from './views.js';

const api = window.fenura;
const app = document.getElementById('app');
const root = document.getElementById('root');

document.documentElement.classList.add(`platform-${api.platform}`);
document.body.classList.add(`platform-${api.platform}`);
app.classList.add(`platform-${api.platform}`);

const player = new Player(api);
const store = new Store(api, player);

// ---------- Тема и цвет обложки ----------

function applyTheme() {
  document.documentElement.dataset.theme = store.isDark ? 'dark' : 'light';
}

function applyAmbient() {
  const color = player.ambient;
  if (color) {
    const to255 = (v) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
    app.style.setProperty('--accent', `rgb(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)})`);
  } else {
    app.style.removeProperty('--accent');
  }
}

store.on('theme', applyTheme);
player.on('ambient', applyAmbient);

// ---------- Экраны ----------

let shell = null;
let login = null;

function buildShell() {
  const main = h('div', { class: 'shell-main' }, createSidebar({ store }), createLibrary({ store, player }));
  return h('div', { class: 'shell' }, main, createPlayerBar({ store, player }));
}

function render() {
  const loggedIn = store.session.loggedIn;
  if (loggedIn && !shell) {
    login = null;
    shell = buildShell();
    root.replaceChildren(shell);
  } else if (!loggedIn && !login) {
    shell = null;
    login = createLogin({ api, store });
    root.replaceChildren(login);
  }
}

store.on('session', render);

api.onSession((snapshot) => store.setSession(snapshot));

// ---------- Адаптивность и экономия ресурсов ----------

const resize = new ResizeObserver(([entry]) => {
  app.classList.toggle('compact', entry.contentRect.width < 860);
});
resize.observe(app);

document.addEventListener('visibilitychange', () => {
  app.classList.toggle('idle', document.hidden);
});
window.addEventListener('blur', () => app.classList.add('idle'));
window.addEventListener('focus', () => app.classList.remove('idle'));

// ---------- Клавиши ----------

const isMac = api.platform === 'darwin';
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.isContentEditable);
  const mod = isMac ? event.metaKey : event.ctrlKey;

  if (mod && event.shiftKey && event.code === 'KeyT') {
    event.preventDefault();
    store.toggleTheme();
    return;
  }
  if (mod && !event.shiftKey && event.code === 'ArrowRight') {
    event.preventDefault();
    player.next();
    return;
  }
  if (mod && !event.shiftKey && event.code === 'ArrowLeft') {
    event.preventDefault();
    player.previous();
    return;
  }
  if (event.code === 'Space' && !typing && !mod && !event.altKey) {
    if (target instanceof HTMLElement && target.tagName === 'BUTTON') target.blur();
    event.preventDefault();
    if (store.session.loggedIn) player.toggle();
  }
});

// ---------- Запуск ----------

(async function start() {
  const init = await api.init();
  store.isDark = init.isDark;
  player.setVolume(init.volume ?? 0.85);
  applyTheme();
  store.session = init.session;
  render();
  if (init.session.loggedIn) store.bootstrap();

  if (api.test) {
    window.__fenura = { store, player, api };
  }
  await document.fonts.ready;
  api.ready({
    hls: Boolean(window.Hls && window.Hls.isSupported()),
    mediaSession: 'mediaSession' in navigator,
    fonts: document.fonts.check('700 14px "Nunito Fenura"'),
    version: init.version
  }).catch(() => undefined);
})();
