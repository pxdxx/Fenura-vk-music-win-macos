'use strict';

// Копирует в src/renderer/vendor всё, что нужно окну приложения без сети: hls.js и шрифт Nunito.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor');
const modules = path.join(root, 'node_modules');

if (!fs.existsSync(path.join(modules, 'hls.js'))) {
  console.log('vendor: зависимости не установлены, пропускаю');
  process.exit(0);
}

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(modules, 'hls.js', 'dist', 'hls.min.js'), path.join(out, 'hls.min.js'));

const fontDir = path.join(modules, '@fontsource-variable', 'nunito', 'files');
const faces = [
  ['cyrillic', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['cyrillic-ext', 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
  ['latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF']
];

let css = '/* Nunito Variable, SIL Open Font License 1.1 */\n';
for (const [name, range] of faces) {
  const file = `nunito-${name}-wght-normal.woff2`;
  fs.copyFileSync(path.join(fontDir, file), path.join(out, 'fonts', file));
  css += `@font-face {\n  font-family: 'Nunito Fenura';\n  font-style: normal;\n  font-display: block;\n  font-weight: 200 1000;\n  src: url(./fonts/${file}) format('woff2');\n  unicode-range: ${range};\n}\n`;
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
fs.copyFileSync(path.join(modules, '@fontsource-variable', 'nunito', 'LICENSE'), path.join(out, 'fonts', 'OFL.txt'));
console.log('vendor: hls.js и шрифты скопированы');
