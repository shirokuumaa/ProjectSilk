// Просимулированная ткань на чужой фигуре: перенос + страховка. Вещь S на фигуре L и
// вещь L на фигуре S — ни одной вершины внутри тела; вершины снаружи не сдвигаются.
// Настоящая болванка (base_avatar.glb) и настоящие драпировки (models/demo-garments).
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { prepareBaseBody, baseBodyShape } from './baseBody';
import { solveAvatar } from './avatarMorphs';
import { figureShape, transferToFigure, pushOutOfBody, countInsideBody, SKIN_GAP } from './sizeModels';
import { readBaseBody, readMeshes } from './testing/readGlb';

const PUBLIC = path.join(__dirname, '../../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'models/demo-garments/manifest.json'), 'utf8'));
const body = prepareBaseBody(readBaseBody(fs.readFileSync(path.join(PUBLIC, 'models/base_avatar.glb'))));
const avatar = { kind: 'base', body };

const FIGURES = {
  S: { heightCm: 156, chest: 80, waist: 62, hips: 86 },
  L: { heightCm: 172, chest: 110, waist: 94, hips: 118 },
};
const buyerShape = (f) => baseBodyShape(body, solveAvatar(FIGURES[f]));

function garment(file) {
  const group = new THREE.Group();
  readMeshes(fs.readFileSync(path.join(PUBLIC, file))).forEach(({ positions, index }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(positions), 3));
    if (index) g.setIndex(Array.from(index));
    group.add(new THREE.Mesh(g));
  });
  return group;
}
const positionsOf = (group) => Float32Array.from(group.children.flatMap((m) => Array.from(m.geometry.attributes.position.array)));

test('both buyer figures are in the base avatar range', () => {
  Object.values(FIGURES).forEach((f) => expect(solveAvatar(f).inRange).toBe(true));
});

const CASES = [];
Object.keys(manifest.items).forEach((item) => {
  CASES.push([item, 'S', 'L'], [item, 'L', 'S']);
});

test.each(CASES)('%s: model %s on figure %s — nothing inside the body, nothing else moved', (item, size, fig) => {
  const model = manifest.items[item].models.find((m) => m.size === size);
  const g = garment(model.file);
  const to = buyerShape(fig);
  transferToFigure(g, figureShape(model.body, avatar), to);

  const before = positionsOf(g);
  const inside = countInsideBody(g, to);
  const pushed = pushOutOfBody(g, to);
  const after = positionsOf(g);

  expect(countInsideBody(g, to)).toBe(0);
  expect(pushed).toBeGreaterThanOrEqual(inside);   // вынесены все, что были внутри

  // сдвинулись только вынесенные вершины, и не дальше, чем нужно
  let moved = 0;
  let maxMove = 0;
  for (let i = 0; i < before.length; i += 3) {
    const d = Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2]);
    if (d > 0) moved++;
    maxMove = Math.max(maxMove, d);
  }
  expect(moved).toBe(pushed);
  // eslint-disable-next-line no-console
  console.log(`${item} ${size}→${fig}: ${before.length / 3} vertices, inside ${inside}, pushed ${pushed}, max move ${(maxMove * 1000).toFixed(1)} mm`);
});

test.each(Object.keys(manifest.items).flatMap((item) => ['S', 'L'].map((size) => [item, size])))(
  'control: %s %s on its own figure is almost entirely outside the body (the check is the real surface)',
  (item, size) => {
    const model = manifest.items[item].models.find((m) => m.size === size);
    const g = garment(model.file);
    const own = baseBodyShape(body, solveAvatar(model.body));
    const n = g.children.reduce((k, m) => k + m.geometry.attributes.position.count, 0);
    expect(countInsideBody(g, own) / n).toBeLessThan(0.025); // Newton: до 1,4 % ткани внутри тела
  },
);

test('the safety gap is 3–5 mm', () => {
  expect(SKIN_GAP).toBeGreaterThanOrEqual(0.003);
  expect(SKIN_GAP).toBeLessThanOrEqual(0.005);
});
