// Развёртка выкройки GarmentCode на драпировках (scripts/garments/export_demo_drapes.py): UV в метрах
// плоской выкройки, одинаковых на всех размерах, и нормали без видимых швов развёртки.
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { prepareBaseBody, baseBodyShape } from './baseBody';
import { solveAvatar } from './avatarMorphs';
import { computeSeamlessNormals, figureShape, pushOutOfBody, transferToFigure } from './sizeModels';
import { readBaseBody, readMeshes } from './testing/readGlb';

const PUBLIC = path.join(__dirname, '../../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'models/demo-garments/manifest.json'), 'utf8'));

const triArea = (p, a, b, c, w) => {
  const u = [0, 1, 2].slice(0, w).map((k) => p[b * w + k] - p[a * w + k]);
  const v = [0, 1, 2].slice(0, w).map((k) => p[c * w + k] - p[a * w + k]);
  if (w === 2) return Math.abs(u[0] * v[1] - u[1] * v[0]) / 2;
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};

const MODELS = Object.entries(manifest.items).flatMap(([item, it]) => it.models.map((m) => [item, m.size, m.file]));

test.each(MODELS)('%s %s: pattern UVs in metres — UV area ≈ fabric area', (item, size, file) => {
  const meshes = readMeshes(fs.readFileSync(path.join(PUBLIC, file)));
  let uvArea = 0;
  let area = 0;
  meshes.forEach(({ positions, index, uv, extras }) => {
    expect(extras.uvMetres).toBe(true);
    expect(uv).not.toBeNull();
    for (let f = 0; f < index.length; f += 3) {
      uvArea += triArea(uv, index[f], index[f + 1], index[f + 2], 2);
      area += triArea(positions, index[f], index[f + 1], index[f + 2], 3);
    }
  });
  // драпировка тянет ткань на проценты; атлас GarmentCode (UV / его ширина) дал бы отношение 1/1,3²…1/2,3²
  expect(uvArea / area).toBeGreaterThan(0.85);
  expect(uvArea / area).toBeLessThan(1.1);
});

test('copies of a seam vertex share one normal after the transfer to the buyer', () => {
  const body = prepareBaseBody(readBaseBody(fs.readFileSync(path.join(PUBLIC, 'models/base_avatar.glb'))));
  const model = manifest.items.dress.models.find((m) => m.size === 'S');
  const group = new THREE.Group();
  readMeshes(fs.readFileSync(path.join(PUBLIC, model.file))).forEach(({ positions, index, uv }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(positions), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(uv), 2));
    g.setIndex(Array.from(index));
    group.add(new THREE.Mesh(g));
  });
  const to = baseBodyShape(body, solveAvatar({ heightCm: 172, chest: 110, waist: 94, hips: 118 }));
  transferToFigure(group, figureShape(model.body, { kind: 'base', body }), to);
  pushOutOfBody(group, to);

  const { position: pos, normal } = group.children[0].geometry.attributes;
  const seen = new Map();
  let copies = 0;
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    if (!seen.has(key)) { seen.set(key, i); continue; }
    const j = seen.get(key);
    copies += 1;
    expect(normal.getX(i)).toBeCloseTo(normal.getX(j), 6);
    expect(normal.getY(i)).toBeCloseTo(normal.getY(j), 6);
    expect(normal.getZ(i)).toBeCloseTo(normal.getZ(j), 6);
  }
  expect(copies).toBeGreaterThan(100);   // швы развёртки есть, и они не разошлись при переносе
});

test('seamless normals: a fold split along its ridge gets one normal on the ridge', () => {
  // два треугольника под углом, ребро-шов раздвоено (у каждой «панели» свои UV)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0, 1, 0, -1, 0.5, 0,          // панель 1
    0, 0, 0, 0, 1, 0, 1, 0.5, 1,           // панель 2: те же две точки шва
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, -1, 0.5, 5, 0, 5, 1, 6, 0.5], 2));
  g.setIndex([0, 2, 1, 3, 4, 5]);
  const plain = g.clone();
  plain.computeVertexNormals();
  const n = (geo, i) => new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, i);
  expect(n(plain, 0).angleTo(n(plain, 3))).toBeGreaterThan(0.5);   // обычный расчёт: на шве излом света

  computeSeamlessNormals(g);
  expect(n(g, 0).angleTo(n(g, 3))).toBeLessThan(1e-6);
  expect(n(g, 1).angleTo(n(g, 4))).toBeLessThan(1e-6);
  expect(n(g, 0).length()).toBeCloseTo(1, 6);
  expect(n(g, 2).angleTo(n(plain, 2))).toBeLessThan(1e-6);        // не на шве — как было
});
