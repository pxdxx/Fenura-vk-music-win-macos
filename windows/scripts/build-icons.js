'use strict';

// Собирает src/renderer/icons.js из набора Lucide (лицензия ISC). Запускается вручную при смене иконок.
const fs = require('fs');
const path = require('path');

const names = [
  'play', 'pause', 'skip-back', 'skip-forward', 'shuffle', 'repeat', 'repeat-1', 'heart', 'volume-2', 'volume-1',
  'volume-x', 'list-music', 'sparkles', 'trending-up', 'search', 'layers', 'headphones', 'sun', 'moon-star', 'refresh-cw'
];
const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const body = {};
for (const name of names) {
  const svg = fs.readFileSync(path.join(dir, `${name}.svg`), 'utf8');
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  body[name] = inner.replace(/\s+/g, ' ').trim();
}
const source = `// Сгенерировано scripts/build-icons.js из Lucide (ISC License, https://lucide.dev). Не править вручную.
export const ICONS = ${JSON.stringify(body, null, 2)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icons.js'), source);
console.log(`icons.js: ${names.length} иконок`);
