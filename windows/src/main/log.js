'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Небольшой журнал в папке данных приложения (%APPDATA%\Fenura\fenura.log). Помогает разбирать сбои без отладчика.
let file = null;

function open() {
  if (file) return file;
  try {
    file = path.join(app.getPath('userData'), 'fenura.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) {
      fs.renameSync(file, `${file}.old`);
    }
  } catch {
    file = '';
  }
  return file;
}

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  if (process.env.FENURA_LOG_STDOUT) process.stdout.write(line);
  const target = open();
  if (!target) return;
  try {
    fs.appendFileSync(target, line);
  } catch {
    // Журнал не должен ломать приложение.
  }
}

module.exports = { log };
