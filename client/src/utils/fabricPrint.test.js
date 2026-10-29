// Принт ткани: квадрат в центре вещи, бесшовная плитка (край продолжает ткань), принт — только на вещи
// с развёрткой выкройки в метрах, повтор 100 / tileCm.
import * as THREE from 'three';
import {
  DEFAULT_TILE_CM, defaultPrintBox, fitPrintBox, isPrint, itemBox, printGarment, printMargin, seamlessTile,
} from './fabricPrint';

/** Фото w×h: белый фон, вещь — прямоугольник item с полосками period px (тёмная/светлая). */
function photo(w, h, item, period = 6) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = item.y; y < item.y + item.h; y++) {
    for (let x = item.x; x < item.x + item.w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.floor(x / (period / 2)) % 2 ? 40 : 200;
      data[i] = v; data[i + 1] = v / 2; data[i + 2] = 90;
    }
  }
  return data;
}

test('the item frame skips the white photo background', () => {
  expect(itemBox(photo(100, 80, { x: 20, y: 10, w: 50, h: 60 }), 100, 80)).toEqual({ x: 20, y: 10, w: 50, h: 60 });
});

test('the default square sits in the centre of the item, 0.3 of its smaller side', () => {
  const box = defaultPrintBox(photo(200, 200, { x: 40, y: 20, w: 100, h: 160 }), 200, 200);
  expect(box.size).toBe(30);
  expect(box.x + box.size / 2).toBeCloseTo(90, 0);
  expect(box.y + box.size / 2).toBeCloseTo(100, 0);
});

test('the square stays inside the photo with room for the fabric past its edges', () => {
  const box = fitPrintBox({ x: 95, y: -10, size: 500 }, 100, 60);
  expect(box.size).toBe(48);                                  // 60 / 1,25
  expect(box.x + box.size + printMargin(box.size)).toBeLessThanOrEqual(100);
  expect(box.y).toBe(0);
});

test('the tile wraps without a seam: its first column continues its last one, like the fabric does', () => {
  const w = 200; const h = 200;
  const data = photo(w, h, { x: 0, y: 0, w, h }, 7);          // период 7 px — не делится на сторону плитки
  const box = { x: 30, y: 40, size: 40 };
  const { data: tile, size } = seamlessTile(data, w, h, box);
  expect(size).toBe(40);
  const at = (x, y) => tile[(y * size + x) * 4];
  const src = (x, y) => data[((box.y + y) * w + box.x + x) * 4];
  // столбец 0 плитки = столбец сразу за правым краем квадрата (полоски по x, по y фото одинаково)
  for (let y = 0; y < size; y++) expect(at(0, y)).toBe(src(size, y));
  // за пределами шва — ткань квадрата как есть
  for (let y = printMargin(size); y < size; y++) {
    for (let x = printMargin(size); x < size; x++) expect(at(x, y)).toBe(src(x, y));
  }
  for (let i = 3; i < tile.length; i += 4) expect(tile[i]).toBe(255);
});

test('a check wraps both ways: the first row and column continue the fabric past the bottom and right edges', () => {
  const w = 160; const h = 160;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[(y * w + x) * 4] = (Math.floor(x / 5) % 2) * 100 + (Math.floor(y / 3) % 2) * 120;
  }
  const box = { x: 20, y: 25, size: 48 };
  const { data: tile, size } = seamlessTile(data, w, h, box);
  const src = (x, y) => data[((box.y + y) * w + box.x + x) * 4];
  expect(tile[0]).toBe(src(size, size));                                           // угол
  for (let x = printMargin(size); x < size; x++) expect(tile[x * 4]).toBe(src(x, size));
  for (let y = printMargin(size); y < size; y++) expect(tile[y * size * 4]).toBe(src(size, y));
});

test('the tile of vertical stripes, laid side by side, changes no more at the joint than inside', () => {
  const w = 300; const h = 120;
  const data = photo(w, h, { x: 0, y: 0, w, h }, 10);
  const { data: tile, size } = seamlessTile(data, w, h, { x: 13, y: 10, size: 64 });
  const row = Array.from({ length: size }, (_, x) => tile[(5 * size + x) * 4]);
  const step = (a, b) => Math.abs(a - b);
  const inside = Math.max(...row.slice(1).map((v, i) => step(v, row[i])));
  expect(step(row[size - 1], row[0])).toBeLessThanOrEqual(inside);   // последний → первый столбец следующей плитки
});

function garment({ uvMetres = true, withUv = true } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6b94c2 }));
  if (uvMetres) mesh.userData.uvMetres = true;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh };
}

test('a print goes on a drape with pattern UVs: repeat 100 / tileCm, white base, material cloned', () => {
  const { root, mesh } = garment();
  const before = mesh.material;
  const load = jest.fn(() => new THREE.Texture());
  expect(printGarment(root, { image: '/models/demo-garments/print.png', tileCm: 4 }, load)).toBe(1);
  expect(load).toHaveBeenCalledWith('/models/demo-garments/print.png');
  expect(mesh.material).not.toBe(before);
  expect(before.map).toBeNull();                      // материал в кэше GLB не тронут
  const { map, color } = mesh.material;
  expect(map.repeat.x).toBe(25);
  expect(map.repeat.y).toBe(25);
  expect(map.wrapS).toBe(THREE.RepeatWrapping);
  expect(map.wrapT).toBe(THREE.RepeatWrapping);
  expect([color.r, color.g, color.b]).toEqual([1, 1, 1]);
});

test('templates without pattern UVs, plain items and broken repeats keep their colour', () => {
  const load = jest.fn(() => new THREE.Texture());
  const template = garment({ uvMetres: false });
  expect(printGarment(template.root, { image: 'x.png', tileCm: 10 }, load)).toBe(0);
  expect(template.mesh.material.map).toBeNull();
  expect(printGarment(garment({ withUv: false }).root, { image: 'x.png', tileCm: 10 }, load)).toBe(0);
  expect(printGarment(garment().root, null, load)).toBe(0);
  expect(printGarment(garment().root, { image: 'x.png', tileCm: 0 }, load)).toBe(0);
  expect(load).not.toHaveBeenCalled();
  expect(isPrint({ image: 'x.png', tileCm: DEFAULT_TILE_CM })).toBe(true);
});
