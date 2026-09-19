'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const defaults = { isDark: true, volume: 0.85, bounds: null };
let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
  if (cache) return cache;
  try {
    cache = { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...defaults };
  }
  return cache;
}

function update(patch) {
  cache = { ...read(), ...patch };
  try {
    fs.writeFileSync(file(), JSON.stringify(cache));
  } catch {
    // Настройки не критичны.
  }
  return cache;
}

module.exports = { read, update };
