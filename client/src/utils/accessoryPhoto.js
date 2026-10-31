// client/src/utils/accessoryPhoto.js
//
// Простая проверка фото аксессуара или обуви в форме продавца: из этого фото делается 3D-модель
// (research/accessories, TRELLIS.2), и лишнее на фото попадает в модель — кольцо слилось с персиком,
// шапка — с манекеном. Проверка ничего не запрещает, только предупреждает.
//
//   checkAccessoryPhoto(rgba, width, height, { kind }) → [предупреждение, …] (по-английски, для продавца)
//
// По пикселям уменьшенного фото (PHOTO_SIDE × PHOTO_SIDE): фон — самый частый цвет рамки (прозрачная рамка —
// фон уже убран, garmentColor.borderColor); вещь — всё, что заметно отличается от фона.

import { BG_DISTANCE, MIN_ALPHA, borderColor } from './garmentColor';

export const PHOTO_SIDE = 96;
const BUSY_BORDER = 30;        // пиксель рамки ближе к цвету фона — фон
const BUSY_SHARE = 0.5;        // фона на рамке меньше половины — пёстрый фон
const MIN_ITEM = 0.03;         // доля кадра: меньше — вещь слишком мелкая
const MAX_ITEM = 0.9;          // больше — фона почти нет
const EDGE_TOUCH = 0.2;        // доля рамки, занятая вещью, — вещь обрезана краем
const SKIN_SHARE = 0.2;        // доля вещи цвета кожи — руки, человек
const PART_SHARE = 0.04;       // кусок вещи меньше этой доли — не отдельный предмет
const PAIRS = ['earrings', 'shoes'];

export const PHOTO_TIPS = [
  'One item only — a pair is fine for earrings and shoes.',
  'A plain, single-colour background.',
  'No hands, model or mannequin in the photo.',
  'The whole item in the frame, with some background around it.',
];

/**
 * Цвет кожи: правило Ковача и др. для RGB при дневном свете, диапазон YCbCr (Cb 77–127, Cr 133–173)
 * при яркости выше 80 и оттенок кожи — красный выше зелёного на 30, зелёный выше синего на 10
 * (без этого кожей считались золото часов и освещённая бордовая кожа туфель).
 */
export function isSkin(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return r > 95 && g > 40 && b > 20 && r > g && r > b
    && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15
    && y > 80 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173
    && r - g > 30 && g - b > 10;
}

function eachBorder(width, height, fn) {
  for (let x = 0; x < width; x++) { fn(x, 0); fn(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { fn(0, y); fn(width - 1, y); }
}

/** Самый частый цвет рамки: среднее самой большой корзины 32 × 32 × 32. */
function borderMode(data, width, height) {
  const bins = new Map();
  eachBorder(width, height, (x, y) => {
    const i = (y * width + x) * 4;
    const key = (data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5);
    const b = bins.get(key) || [0, 0, 0, 0];
    b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3] += 1;
    bins.set(key, b);
  });
  let best = null;
  bins.forEach((b) => { if (!best || b[3] > best[3]) best = b; });
  return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
}

/** Куски маски (4-связность), площади по убыванию. */
function parts(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const areas = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      area += 1;
      const x = i % width;
      const y = (i - x) / width;
      const near = [x > 0 && i - 1, x < width - 1 && i + 1, y > 0 && i - width, y < height - 1 && i + width];
      near.forEach((j) => {
        if (j !== false && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      });
    }
    areas.push(area);
  }
  return areas.sort((a, b) => b - a);
}

/**
 * Предупреждения по фото аксессуара; пустой список — с фото всё в порядке.
 * @param {Uint8ClampedArray|number[]} data RGBA
 */
export function checkAccessoryPhoto(data, width, height, { kind } = {}) {
  // фон — самый частый цвет рамки (вещь, задевшая край, не сбивает его); прозрачная рамка — фон уже убран
  const bg = borderColor(data, width, height) && borderMode(data, width, height);
  const warnings = [];
  let busy = false;
  if (bg) {
    let near = 0;
    let n = 0;
    eachBorder(width, height, (x, y) => {
      const i = (y * width + x) * 4;
      if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) < BUSY_BORDER) near += 1;
      n += 1;
    });
    busy = near / n < BUSY_SHARE;
    if (busy) warnings.push('The background is busy. Shoot the item on a plain, single-colour background.');
  }

  const mask = new Uint8Array(width * height);
  let item = 0;
  let skin = 0;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (data[i + 3] < MIN_ALPHA) continue;
    if (bg && Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) < BG_DISTANCE) continue;
    mask[p] = 1;
    item += 1;
    if (isSkin(data[i], data[i + 1], data[i + 2])) skin += 1;
  }
  if (busy) return warnings;            // на пёстром фоне вещь от фона не отделить — остальное не проверяем

  const share = item / mask.length;
  if (share < MIN_ITEM) warnings.push('The item is very small in the photo. Let it fill most of the frame.');
  if (share > MAX_ITEM) warnings.push('The item fills the whole photo. Leave some plain background around it.');

  let edge = 0;
  let border = 0;
  eachBorder(width, height, (x, y) => { edge += mask[y * width + x]; border += 1; });
  if (share <= MAX_ITEM && edge / border > EDGE_TOUCH) {
    warnings.push('The item touches the edge of the photo. Keep the whole item in the frame.');
  }

  if (item && skin / item > SKIN_SHARE) {
    warnings.push('There seem to be hands, skin or a person in the photo. Photograph the item on its own.');
  }

  const big = parts(mask, width, height).filter((a) => a >= PART_SHARE * item);
  if (big.length > (PAIRS.includes(kind) ? 2 : 1)) {
    warnings.push(PAIRS.includes(kind)
      ? 'There seem to be more than two items. Show one item or one pair.'
      : 'There seem to be several items. Show one item on its own.');
  }
  return warnings;
}

/** То же по адресу картинки: уменьшенная копия на холсте; null — проверить не удалось. */
export async function checkAccessoryPhotoUrl(url, options) {
  if (!url || typeof document === 'undefined') return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIDE;
    canvas.height = PHOTO_SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
    return checkAccessoryPhoto(ctx.getImageData(0, 0, PHOTO_SIDE, PHOTO_SIDE).data, PHOTO_SIDE, PHOTO_SIDE, options);
  } catch {
    return null;
  }
}
