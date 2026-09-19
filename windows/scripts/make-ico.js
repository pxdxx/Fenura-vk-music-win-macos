'use strict';

// Собирает build/icon.ico из PNG-размеров (иконка та же, что в macOS-версии, со скруглённым квадратом).
// Использование: node scripts/make-ico.js build/icons-tmp build/icon.ico
const fs = require('fs');
const path = require('path');

const [dir, out] = process.argv.slice(2);
const sizes = fs.readdirSync(dir)
  .map((file) => parseInt(path.basename(file, '.png'), 10))
  .filter(Boolean)
  .sort((a, b) => a - b);

const images = sizes.map((size) => fs.readFileSync(path.join(dir, `${size}.png`)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + sizes.length * 16;
const entries = sizes.map((size, index) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(images[index].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += images[index].length;
  return entry;
});

fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images]));
console.log(`${out}: ${sizes.join(', ')}`);
