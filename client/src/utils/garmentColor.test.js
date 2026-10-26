// Основной цвет вещи по фото и перекраска в примерке.
import * as THREE from 'three';
import { dominantColor, isColor, tintGarment } from './garmentColor';

/** Картинка w×h: fill(x, y) → [r, g, b, a]. */
function image(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  }
  return data;
}
const inside = (x, y, w, h) => x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8;

test('a red dress on a white studio background is red, not white', () => {
  const data = image(40, 40, (x, y) => (inside(x, y, 40, 40) ? [200, 30, 40, 255] : [250, 250, 250, 255]));
  expect(dominantColor(data, 40, 40)).toBe('#c81e28');
});

test('a white shirt with the background already removed (transparent) stays white', () => {
  const data = image(40, 40, (x, y) => (inside(x, y, 40, 40) ? [245, 245, 242, 255] : [0, 0, 0, 0]));
  expect(dominantColor(data, 40, 40)).toBe('#f5f5f2');
});

test('the largest colour wins over a small print', () => {
  const data = image(40, 40, (x, y) => {
    if (!inside(x, y, 40, 40)) return [0, 0, 0, 0];
    return x < 14 ? [250, 220, 0, 255] : [20, 40, 120, 255];   // жёлтый принт на синем
  });
  expect(dominantColor(data, 40, 40)).toBe('#142878');
});

test('nothing but background — no colour', () => {
  expect(dominantColor(image(10, 10, () => [255, 255, 255, 255]), 10, 10)).toBeNull();
  expect(dominantColor(image(10, 10, () => [0, 0, 0, 0]), 10, 10)).toBeNull();
});

test('isColor accepts only #rrggbb', () => {
  expect(isColor('#A1b2C3')).toBe(true);
  ['', 'red', '#fff', '#12345g', null].forEach((v) => expect(isColor(v)).toBe(false));
});

describe('tintGarment', () => {
  function garment() {
    const shared = new THREE.MeshStandardMaterial({ color: '#9fc5e8', map: new THREE.Texture() });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [shared, shared]));
    return { root, shared };
  }

  test('paints every material in the product colour and drops foreign textures', () => {
    const { root, shared } = garment();
    tintGarment(root, '#c81e28');
    const mats = [];
    root.traverse((c) => { if (c.isMesh) mats.push(...[].concat(c.material)); });
    expect(mats).toHaveLength(3);
    mats.forEach((m) => {
      expect(`#${m.color.getHexString()}`).toBe('#c81e28');
      expect(m.map).toBeNull();
      expect(m).not.toBe(shared);              // общий материал из кэша GLB не тронут
    });
    expect(`#${shared.color.getHexString()}`).toBe('#9fc5e8');
    expect(shared.map).not.toBeNull();
  });

  test('without a colour nothing changes', () => {
    const { root, shared } = garment();
    tintGarment(root, null);
    expect(root.children[0].material).toBe(shared);
  });
});
