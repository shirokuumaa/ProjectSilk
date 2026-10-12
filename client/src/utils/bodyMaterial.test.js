// Цвет токена должен попасть в шейдер в линейном пространстве ровно один раз:
// sRGB-hex → линейный (THREE.Color при включённом ColorManagement), а обратно
// в sRGB его переводит рендерер на выходе. Двойной перевод затемнил бы тело.
import * as THREE from 'three';
import { createBodyMaterial, skinColor } from './bodyMaterial';

const SKIN_6 = '#A07E56';
const UNDERWEAR = '#9EA3AA';

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearOf = (hex) => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

beforeAll(() => {
  document.documentElement.style.setProperty('--skin-6', SKIN_6);
  document.documentElement.style.setProperty('--underwear', UNDERWEAR);
});

test('colour management is on', () => {
  expect(THREE.ColorManagement.enabled).toBe(true);
});

test('skin tone token → linear once', () => {
  const c = skinColor('skin-6');
  const [r, g, b] = linearOf(SKIN_6);
  expect(c.r).toBeCloseTo(r, 5);
  expect(c.g).toBeCloseTo(g, 5);
  expect(c.b).toBeCloseTo(b, 5);
  expect(`#${c.getHexString()}`.toUpperCase()).toBe(SKIN_6);
});

test('underwear token → linear once, the same uniform for every tone', () => {
  const m = createBodyMaterial({ underwear: 'attribute', skinTone: 'skin-6' });
  const u = m.userData.uniforms.uUnderwearColor.value;
  const [r, g, b] = linearOf(UNDERWEAR);
  expect(u.r).toBeCloseTo(r, 5);
  expect(u.g).toBeCloseTo(g, 5);
  expect(u.b).toBeCloseTo(b, 5);
  expect(`#${u.getHexString()}`.toUpperCase()).toBe(UNDERWEAR);
  expect(m.color.equals(skinColor('skin-6'))).toBe(true);
});
