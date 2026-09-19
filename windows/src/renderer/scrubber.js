import { h } from './dom.js';

// Ползунок как FenuraScrubber: тонкая дорожка с градиентом. Прогресс идёт через scaleX, без перерисовки макета.
export function createScrubber({ onInput, onCommit, label, live = false }) {
  const fill = h('div', { class: 'fill' });
  const knob = h('div', { class: 'knob' });
  const root = h('div', {
    class: 'scrub disabled',
    role: 'slider',
    tabindex: '0',
    'aria-label': label,
    'aria-valuemin': '0'
  }, h('div', { class: 'rail' }, fill), knob);

  let min = 0;
  let max = 1;
  let value = 0;
  let dragging = false;

  const ratioOf = (v) => Math.min(Math.max((v - min) / Math.max(max - min, 0.0001), 0), 1);
  const paint = (v) => {
    root.style.setProperty('--p', String(ratioOf(v)));
    root.setAttribute('aria-valuenow', String(Math.round(v)));
  };

  const valueAt = (event) => {
    const rect = root.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return min + ratio * (max - min);
  };

  root.addEventListener('pointerdown', (event) => {
    if (root.classList.contains('disabled') || event.button !== 0) return;
    dragging = true;
    root.classList.add('drag');
    root.setPointerCapture(event.pointerId);
    value = valueAt(event);
    paint(value);
    onInput?.(value);
    if (live) onCommit?.(value);
  });
  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    value = valueAt(event);
    paint(value);
    onInput?.(value);
    if (live) onCommit?.(value);
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('drag');
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (!live) onCommit?.(value);
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('keydown', (event) => {
    const step = (max - min) * (live ? 0.05 : 0.02);
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    value = Math.min(max, Math.max(min, value + delta));
    paint(value);
    onInput?.(value);
    onCommit?.(value);
  });

  return {
    el: root,
    get dragging() {
      return dragging;
    },
    set(next, range) {
      if (range) {
        min = range[0];
        max = range[1];
        root.setAttribute('aria-valuemax', String(Math.round(max)));
      }
      if (dragging) return;
      value = next;
      paint(value);
    },
    enable(on) {
      root.classList.toggle('disabled', !on);
    }
  };
}
