// client/src/utils/fabricPrint.js
//
// Принт ткани. Продавец выделяет на фото товара квадрат ткани (по умолчанию — в центре вещи), из него
// делается бесшовная плитка; у товара хранятся плитка и сколько сантиметров ткани занимает её повтор
// (product.print = { image, tileCm }). В примерке плитка ложится на развёртку выкройки драпировки: UV там
// в метрах плоской выкройки (scripts/garments/export_demo_drapes.py, пометка userData.uvMetres), повтор —
// 100 / tileCm, одинаково на всех размерах. Вещи без такой развёртки (общие шаблоны) остаются в цвете.
//
//   itemBox(rgba, w, h) — рамка вещи на фото: без прозрачного и цвета рамки фото (как garmentColor);
//   defaultPrintBox(rgba, w, h) — квадрат ткани в центре вещи;
//   fitPrintBox(box, w, h) — квадрат в пределах фото, с запасом ткани справа и снизу для сшивки краёв;
//   seamlessTile(rgba, w, h, box) — бесшовная плитка: левый и верхний края сведены с тканью, что идёт
//     сразу за правым и нижним краем квадрата, — повтор продолжает ткань, а не обрывает её;
//   makePrintTile(src, box) — то же по картинке (холст) → { blob, url };
//   printGarment(root, print, loadTexture) — положить принт на вещь.
import * as THREE from 'three';
import { BG_DISTANCE, MIN_ALPHA, borderColor } from './garmentColor';

/** Повтор по умолчанию, см ткани на плитку: клетка, полоска, мелкий цветок. */
export const DEFAULT_TILE_CM = 10;
export const MIN_TILE_CM = 1;
export const MAX_TILE_CM = 200;

const MIN_SIDE = 8;          // меньше — не плитка, а пятно
const DEFAULT_SHARE = 0.3;   // сторона квадрата по умолчанию — доля меньшей стороны вещи
const TILE_MAX_PX = 512;     // плитка в файле не больше

/** Запас ткани за квадратом для сшивки краёв, px: четверть стороны. */
export const printMargin = (side) => Math.max(1, Math.ceil(side * 0.25));

/** Рамка вещи на фото { x, y, w, h }; null — на фото только фон. */
export function itemBox(data, width, height) {
  const bg = borderColor(data, width, height);
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < MIN_ALPHA) continue;
      if (bg && Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) < BG_DISTANCE) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Квадрат в пределах фото: сторона + запас помещаются, сторона не меньше MIN_SIDE. Целые px. */
export function fitPrintBox(box, width, height) {
  const maxSide = Math.floor(Math.min(width, height) / 1.25);
  const size = Math.max(Math.min(Math.round(box.size), maxSide), Math.min(MIN_SIDE, maxSide));
  const room = size + printMargin(size);
  const clamp = (v, hi) => Math.min(Math.max(Math.round(v), 0), Math.max(hi, 0));
  return { x: clamp(box.x, width - room), y: clamp(box.y, height - room), size };
}

/** Квадрат ткани по умолчанию: в центре вещи, 0,3 её меньшей стороны (без вещи — центр фото). */
export function defaultPrintBox(data, width, height) {
  const item = itemBox(data, width, height) || { x: 0, y: 0, w: width, h: height };
  const size = Math.min(item.w, item.h) * DEFAULT_SHARE;
  return fitPrintBox({ x: item.x + (item.w - size) / 2, y: item.y + (item.h - size) / 2, size }, width, height);
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Бесшовная плитка из квадрата box фото (RGBA). Сначала по x: в первых m столбцах ткань квадрата плавно
 * переходит в ту, что лежит на сторону квадрата правее, — столбец 0 равен столбцу сразу за правым краем, и
 * следующая плитка продолжает ткань. Потом так же по y. Нужен запас m = printMargin справа и снизу (fitPrintBox).
 * @returns {{ data: Uint8ClampedArray, size: number }}
 */
export function seamlessTile(data, width, height, box) {
  const { x: bx, y: by, size } = fitPrintBox(box, width, height);
  const m = printMargin(size);
  const rows = size + m;
  const px = (x, y, c) => data[((by + y) * width + bx + x) * 4 + c];

  // по x: size столбцов × (size + m) строк
  const wide = new Float32Array(size * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < size; x++) {
      const w = x < m ? smooth(x / m) : 1;
      for (let c = 0; c < 3; c++) {
        wide[(y * size + x) * 4 + c] = w < 1 ? w * px(x, y, c) + (1 - w) * px(x + size, y, c) : px(x, y, c);
      }
    }
  }
  // по y: size × size
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const w = y < m ? smooth(y / m) : 1;
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        const own = wide[(y * size + x) * 4 + c];
        out[(y * size + x) * 4 + c] = Math.round(w < 1 ? w * own + (1 - w) * wide[((y + size) * size + x) * 4 + c] : own);
      }
      out[(y * size + x) * 4 + 3] = 255;
    }
  }
  return { data: out, size };
}

/** Картинка по адресу; с сервера — с CORS, иначе холст её не прочитает. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(src).startsWith('blob:') && !String(src).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The photo could not be loaded.'));
    img.src = src;
  });
}

/** Пиксели картинки в натуральном размере. */
export function imagePixels(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** Плитка (JPEG, не больше 512 px) из квадрата box картинки img → { blob, url }. */
export async function makePrintTile(img, box) {
  const { data, width, height } = imagePixels(img);
  const tile = seamlessTile(data, width, height, box);
  const full = document.createElement('canvas');
  full.width = tile.size;
  full.height = tile.size;
  full.getContext('2d').putImageData(new ImageData(tile.data, tile.size, tile.size), 0, 0);
  const side = Math.min(tile.size, TILE_MAX_PX);
  const out = document.createElement('canvas');
  out.width = side;
  out.height = side;
  out.getContext('2d').drawImage(full, 0, 0, side, side);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('The print tile could not be made.');
  return { blob, url: URL.createObjectURL(blob) };
}

/** Принт товара годится: плитка и повтор в пределах 1…200 см. */
export const isPrint = (print) => !!print?.image && Number(print.tileCm) >= MIN_TILE_CM && Number(print.tileCm) <= MAX_TILE_CM;

function defaultLoadTexture(url) {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Положить принт на вещь: сетки с развёрткой выкройки в метрах (userData.uvMetres) получают плитку с повтором
 * 100 / tileCm и белый цвет; остальные не меняются — остаются в цвете
 * товара. Материалы клонируются (кэш GLB общий). Возвращает, на сколько сеток лёг принт.
 */
export function printGarment(root, print, loadTexture = defaultLoadTexture) {
  if (!root || !isPrint(print)) return 0;
  let texture = null;
  let printed = 0;
  root.traverse((child) => {
    if (!child.isMesh || !child.material || !child.userData?.uvMetres || !child.geometry?.attributes?.uv) return;
    if (!texture) {
      texture = loadTexture(print.image);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const repeat = 100 / Number(print.tileCm);
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = 8;
    }
    const apply = (m) => {
      const c = m.clone();
      c.map = texture;
      c.color?.setScalar(1);          // белый: цвет умножается на плитку
      c.needsUpdate = true;
      return c;
    };
    child.material = Array.isArray(child.material) ? child.material.map(apply) : apply(child.material);
    printed += 1;
  });
  return printed;
}
