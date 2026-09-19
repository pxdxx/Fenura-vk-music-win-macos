'use strict';

const { net, nativeImage } = require('electron');

const cache = new Map();
const SAMPLE = 12;

// Средний цвет обложки для подсветки фона. Считаем в главном процессе, чтобы не упираться в CORS.
async function averageColor(url) {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return null;
  if (cache.has(url)) return cache.get(url);
  let color = null;
  try {
    const response = await net.fetch(url);
    if (response.ok) {
      const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
      if (!image.isEmpty()) {
        const small = image.resize({ width: SAMPLE, height: SAMPLE, quality: 'good' });
        const bitmap = small.toBitmap();
        let r = 0;
        let g = 0;
        let b = 0;
        const pixels = bitmap.length / 4;
        for (let i = 0; i < bitmap.length; i += 4) {
          // toBitmap отдаёт BGRA.
          b += bitmap[i];
          g += bitmap[i + 1];
          r += bitmap[i + 2];
        }
        if (pixels > 0) color = { r: r / pixels / 255, g: g / pixels / 255, b: b / pixels / 255 };
      }
    }
  } catch {
    color = null;
  }
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(url, color);
  return color;
}

module.exports = { averageColor };
