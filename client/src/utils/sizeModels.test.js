// Модели размеров: выбор ближайшего размера и перенос ткани на другую фигуру.
import * as THREE from 'three';
import { pickSizeModel, heightMap, transferToFigure } from './sizeModels';
import { proceduralBodyShape } from './bodyShape';

const product = {
  sizeChart: [
    { size: 'XS', chest: 77, waist: 64, hips: 81 },
    { size: 'S', chest: 80, waist: 66, hips: 85 },
    { size: 'M', chest: 83, waist: 68, hips: 89 },
    { size: 'L', chest: 86, waist: 70, hips: 93 },
    { size: 'XL', chest: 89, waist: 72, hips: 97 },
  ],
  sizeModels: [
    { size: 'S', model3d: '/m/dress_S.glb', body: { heightCm: 166, chest: 86, waist: 66, hips: 94 } },
    { size: 'L', model3d: '/m/dress_L.glb', body: { heightCm: 166, chest: 96, waist: 76, hips: 104 } },
  ],
};
const row = (size) => product.sizeChart.find((r) => r.size === size);

describe('pickSizeModel', () => {
  test.each([['S', 'S'], ['L', 'L'], ['XS', 'S'], ['XL', 'L']])('%s → model %s', (size, model) => {
    expect(pickSizeModel(product, row(size)).size).toBe(model);
  });

  test('exactly between S and L (M) → the larger one', () => {
    expect(pickSizeModel(product, row('M')).size).toBe('L');
  });

  test('without a size → the first model; without models → null', () => {
    expect(pickSizeModel(product, null).size).toBe('S');
    expect(pickSizeModel({ sizeChart: product.sizeChart }, row('S'))).toBeNull();
  });

  test('a chart with lengths only: by order in the chart', () => {
    const p = { sizeChart: [{ size: 'S', length: 60 }, { size: 'M', length: 62 }, { size: 'L', length: 64 }, { size: 'XL', length: 66 }],
      sizeModels: [{ size: 'S' }, { size: 'XL' }] };
    expect(pickSizeModel(p, { size: 'M', length: 62 }).size).toBe('S');
    expect(pickSizeModel(p, { size: 'L', length: 64 }).size).toBe('XL');
  });
});

describe('transfer to another figure', () => {
  const sim = proceduralBodyShape({ heightCm: 166, chest: 86, waist: 66, hips: 94 });
  const tall = proceduralBodyShape({ heightCm: 180, chest: 86, waist: 66, hips: 94 });

  test('landmarks map onto landmarks; the floor stays at 0', () => {
    const map = heightMap(sim, tall);
    expect(map(0)).toBe(0);
    ['hips', 'waist', 'chest', 'shoulder'].forEach((k) => {
      expect(map(sim.landmarks[k])).toBeCloseTo(tall.landmarks[k], 6);
    });
  });

  test('a ring of fabric at the sim waist ends at the buyer waist, same gap to the body', () => {
    const y = sim.landmarks.waist;
    const s = sim.surfaceAt(y, 1, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([s.cx + 0.2, y, s.cz, s.cx - 0.2, y, s.cz], 3));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo));
    transferToFigure(root, sim, tall);
    const p = geo.attributes.position;
    const t = tall.surfaceAt(tall.landmarks.waist, 1, 0);
    expect(p.getY(0)).toBeCloseTo(tall.landmarks.waist, 6);
    expect(p.getX(0) - t.cx).toBeCloseTo(0.2, 6);
    expect(p.getX(1) - t.cx).toBeCloseTo(-0.2, 6);
  });
});

test('on a wider body the fabric keeps its gap: a ring 2 cm off the waist stays 2 cm off', () => {
  const sim = proceduralBodyShape({ heightCm: 166, chest: 86, waist: 66, hips: 94 });
  const wide = proceduralBodyShape({ heightCm: 166, chest: 110, waist: 94, hips: 118 });
  const y = sim.landmarks.waist;
  const s = sim.surfaceAt(y, 1, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([s.cx + s.r + 0.02, y, s.cz], 3));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo));
  transferToFigure(root, sim, wide);
  const w = wide.surfaceAt(wide.landmarks.waist, 1, 0);
  expect(geo.attributes.position.getX(0) - (w.cx + w.r)).toBeCloseTo(0.02, 4);
});
