'use strict';

// Проверка обычного (не демо) режима: `Fenura.exe --smoke-real --out=папка`.
// Проходит путь, который видит пользователь: показ окна, окно входа ВКонтакте, завершение входа и возврат в приложение.
// Настоящий вход в VK недоступен, поэтому завершение входа имитируется через ту же функцию, что вызывает сайт.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, desktopCapturer, screen, session } = require('electron');

let started = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function option(args, name) {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : '';
}

async function run({ getWindow, login, store, report, args }) {
  if (started) return;
  started = true;
  const out = option(args, '--out') || path.join(os.tmpdir(), 'fenura-real');
  fs.mkdirSync(out, { recursive: true });
  const checks = { startup: report };
  const events = [];

  const finish = (ok) => {
    checks.ok = ok;
    checks.platform = process.platform;
    checks.events = events;
    try {
      checks.log = fs.readFileSync(path.join(app.getPath('userData'), 'fenura.log'), 'utf8').split('\n').slice(-80);
    } catch {
      checks.log = [];
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(checks, null, 2));
    setTimeout(() => app.exit(ok ? 0 : 1), 300);
  };
  setTimeout(() => {
    events.push('global timeout');
    finish(false);
  }, 120_000).unref();

  const desktop = async (name) => {
    try {
      const size = screen.getPrimaryDisplay().size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      if (sources[0]) fs.writeFileSync(path.join(out, name), sources[0].thumbnail.toPNG());
    } catch (error) {
      events.push(`desktop capture failed: ${error.message}`);
    }
  };

  const state = (win) => (win && !win.isDestroyed()
    ? { visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused(), bounds: win.getBounds() }
    : null);

  try {
    // 1. Главное окно должно стать видимым само, без вмешательства.
    let win = getWindow();
    for (let i = 0; i < 50 && !(win && win.isVisible()); i++) {
      await wait(100);
      win = getWindow();
    }
    checks.mainWindowVisible = Boolean(win && win.isVisible());
    checks.mainWindow = state(win);
    checks.workArea = screen.getPrimaryDisplay().workArea;
    await wait(500);
    await desktop('1-desktop-after-start.png');

    // 2. Экран входа должен сам открыть окно ВКонтакте.
    for (let i = 0; i < 60 && !login.isOpen(); i++) await wait(100);
    checks.loginWindowOpened = login.isOpen();
    checks.loginWindow = state(login.window);
    await wait(2500);
    await desktop('2-desktop-login-window.png');

    // 3. Имитируем успешный вход: окно входа закрывается, приложение продолжает работать.
    events.push('completing login');
    // Поддельная кука сессии, чтобы приложение дошло до настоящего сетевого запроса токена.
    await session.fromPartition('persist:vk').cookies.set({
      url: 'https://vk.ru', name: 'remixsid', value: 'f'.repeat(40), domain: '.vk.ru', secure: true
    }).catch((error) => events.push(`cookie set failed: ${error.message}`));
    login.completeFromCookies();
    await wait(300);
    checks.loginWindowClosed = !login.isOpen();

    win = getWindow();
    const ping = await Promise.race([
      win.webContents.executeJavaScript('1 + 1').then((v) => v === 2),
      wait(5000).then(() => false)
    ]);
    checks.rendererResponsive = ping;
    checks.mainWindowAfterLogin = state(win);

    // 4. Запрос токена к ВКонтакте с поддельной сессией должен закончиться сообщением, а не зависанием.
    const started = Date.now();
    let idle = false;
    for (let i = 0; i < 400; i++) {
      await wait(150);
      if (!store.isBusy && i > 3) {
        idle = true;
        break;
      }
    }
    checks.finishOAuthSeconds = Math.round((Date.now() - started) / 100) / 10;
    checks.finishOAuthCompleted = idle;
    checks.errorShown = await win.webContents.executeJavaScript(
      "(document.querySelector('.login-card .error') || {}).textContent || ''"
    ).catch(() => '');
    checks.loginScreenBack = await win.webContents.executeJavaScript("Boolean(document.querySelector('.login-card'))")
      .catch(() => false);

    // 5. После этого окно входа должно открываться снова по кнопке.
    await win.webContents.executeJavaScript("document.querySelector('.login-card .pill') && document.querySelector('.login-card .pill').click()")
      .catch(() => undefined);
    for (let i = 0; i < 40 && !login.isOpen(); i++) await wait(100);
    checks.loginReopens = login.isOpen();
    await wait(1500);
    await desktop('3-desktop-login-reopened.png');

    const ok = checks.mainWindowVisible && checks.loginWindowOpened && checks.loginWindowClosed
      && checks.rendererResponsive && checks.finishOAuthCompleted && checks.loginReopens;
    finish(Boolean(ok));
  } catch (error) {
    events.push(String(error && error.stack ? error.stack : error));
    finish(false);
  }
}

module.exports = { run };
