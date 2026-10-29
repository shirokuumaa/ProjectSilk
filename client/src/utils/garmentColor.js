// client/src/utils/garmentColor.js
//
// Основной цвет вещи: снимается с фото товара в форме продавца (продавец может поправить)
// и хранится у товара (product.color, '#rrggbb'). В примерке драпировки и шаблоны
// перекрашиваются в него — вместо голубого макета и чужих текстур шаблонов.
//
//   dominantColor(rgba, width, height) — по пикселям: фон (цвет рамки фото) и прозрачное
//     отбрасываются, остальное раскладывается по корзинам 16×16×16; цвет — среднее самой
//     большой корзины;
//   imageColor(file) — то же по файлу картинки (холст 64×64);
//   tintGarment(root, color) — перекрасить вещь: материалы клонируются (кэш GLB общий),
//     текстура снимается, цвет — color.

const BIN = 16;              // шаг квантования по каналу
export const BG_DISTANCE = 48;      // ближе к цвету фона — это фон
export const MIN_ALPHA = 128;

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Цвет рамки фото, если она непрозрачная; иначе null (фон уже убран). */
export function borderColor(data, width, height) {
  let r = 0, g = 0, b = 0, n = 0, opaque = 0, total = 0;
  const take = (x, y) => {
    const i = (y * width + x) * 4;
    total += 1;
    if (data[i + 3] < MIN_ALPHA) return;
    opaque += 1;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  };
  for (let x = 0; x < width; x++) { take(x, 0); take(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { take(0, y); take(width - 1, y); }
  if (opaque < total / 2) return null;
  return [r / n, g / n, b / n];
}

/**
 * Основной цвет по пикселям RGBA.
 * @returns {string | null} '#rrggbb'; null — на фото нет ничего, кроме фона
 */
export function dominantColor(data, width, height) {
  const bg = borderColor(data, width, height);
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (bg && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < BG_DISTANCE) continue;
    const key = ((r / BIN) | 0) * 256 + ((g / BIN) | 0) * 16 + ((b / BIN) | 0);
    const s = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    s.n += 1; s.r += r; s.g += g; s.b += b;
    bins.set(key, s);
  }
  let best = null;
  bins.forEach((s) => { if (!best || s.n > best.n) best = s; });
  return best ? hex(best.r / best.n, best.g / best.n, best.b / best.n) : null;
}

/** Основной цвет файла картинки; null — не получилось (нет холста, битый файл). */
export async function imageColor(file) {
  if (!file || typeof document === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    return dominantColor(ctx.getImageData(0, 0, size, size).data, size, size);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Перекрасить вещь в цвет товара; без цвета — ничего не меняется. */
export function tintGarment(root, color) {
  if (!root || !isColor(color)) return;
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const tint = (m) => {
      const c = m.clone();
      if (c.map) c.map = null;
      c.color?.set(color);
      c.needsUpdate = true;
      return c;
    };
    child.material = Array.isArray(child.material) ? child.material.map(tint) : tint(child.material);
  });
}
