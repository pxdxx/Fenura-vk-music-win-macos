import { ICONS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, extra = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ic ${extra}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function artwork(url, size, radius) {
  const node = h('div', { class: 'art', style: `--s:${size}px;--r:${radius}px` }, icon('headphones'));
  if (url) {
    const img = h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = url;
    node.append(img);
  }
  return node;
}

export function setArtwork(node, url) {
  node.querySelector('img')?.remove();
  if (!url) return;
  const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
  img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  img.src = url;
  node.append(img);
}

export function wordmark(markSize, fontSize) {
  return h('div', { class: 'wordmark', style: `--mark:${markSize}px;--word:${fontSize}px`, 'aria-label': 'Fenura' },
    h('img', { src: 'mark.png', alt: '', draggable: 'false' }),
    h('span', { text: 'Fenura' }));
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatClock(time) {
  return Number.isFinite(time) ? formatDuration(time) : '0:00';
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
