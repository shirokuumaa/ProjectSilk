// Прогон подгонки одежды (вариант B): тестовые фигуры × вещи × размеры S и L.
// В обычном npm test пропускается; запуск:
//   GARMENT_HARNESS=1 CI=true npx react-scripts test --watchAll=false src/utils/garmentFit.harness.test.js
// Пишет в scripts/garments/out/runs/: вещь до и после подгонки (Float32, glTF-координаты),
// треугольники и meta.json — их читает scripts/garments/eval_fit.py (метрики и картинки).
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import calibration from '../data/avatarCalibration.json';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape, prepareBaseBody } from './baseBody';
import { proceduralBodyShape } from './bodyShape';
import { drapeGarment } from './garmentDrape';
import { placeByHeight } from './garmentPlacement';
import { readBaseBody, readMeshes } from './testing/readGlb';

const RUN = !!process.env.GARMENT_HARNESS;
const PUBLIC = path.join(__dirname, '../../public');
const OUT = path.join(__dirname, '../../../scripts/garments/out/runs');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'models/test-garments/manifest.json'), 'utf8'));

const ITEMS = ['dress', 'tee', 'blouse', 'jeans', 'leggings', 'skirt', 'croptop', 'shorts'];
const SIZES = ['S', 'L'];
const asProfile = (r) => ({
  heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips,
  shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam,
});

function garmentGroup(meshes) {
  const group = new THREE.Group();
  meshes.forEach(({ positions, index }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(positions), 3));
    if (index) g.setIndex(Array.from(index));
    group.add(new THREE.Mesh(g));
  });
  return group;
}

function worldPositions(group) {
  group.updateWorldMatrix(true, true);
  const out = [];
  const v = new THREE.Vector3();
  group.children.forEach((m) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return Float32Array.from(out);
}

function indices(group) {
  const out = [];
  let base = 0;
  group.children.forEach((m) => {
    const g = m.geometry;
    const n = g.attributes.position.count;
    if (g.index) g.index.array.forEach((i) => out.push(i + base));
    else for (let i = 0; i < n; i++) out.push(i + base);
    base += n;
  });
  return Uint32Array.from(out);
}

(RUN ? describe : describe.skip)('garment fit harness', () => {
  const body = RUN ? prepareBaseBody(readBaseBody(fs.readFileSync(path.join(PUBLIC, 'models/base_avatar.glb')))) : null;
  const garmentCache = {};
  const meshesOf = (file) => {
    if (!garmentCache[file]) garmentCache[file] = readMeshes(fs.readFileSync(path.join(PUBLIC, file)));
    return garmentCache[file];
  };

  test('run all figures × items × sizes', () => {
    fs.mkdirSync(OUT, { recursive: true });
    const meta = { figures: {}, runs: [] };
    const figures = Object.entries(calibration.validation.testFigures);

    figures.forEach(([fig, f]) => {
      const profile = asProfile(f.requested);
      const solution = solveAvatar(profile);
      let shape;
      let kind;
      if (solution.inRange) {
        shape = baseBodyShape(body, solution);
        kind = 'base';
      } else {
        shape = proceduralBodyShape(profile);   // как в приложении: вне диапазона — стандартное тело
        kind = 'standard';
      }
      meta.figures[fig] = { kind, controls: solution.controls, buildMs: shape.buildMs ?? null, landmarks: shape.landmarks };
      const items = kind === 'base' ? ITEMS : ['tee', 'jeans'];

      items.forEach((itemId) => {
        const item = manifest.items.find((i) => i.id === itemId);
        const variants = itemId === 'dress' ? [['seller', item.file]] : [['seller', item.sellerFile], ['ideal', item.file]];
        variants.forEach(([variant, file]) => {
          SIZES.forEach((sizeName) => {
            const row = item.sizeChart.find((s) => s.size === sizeName);
            const group = garmentGroup(meshesOf(file));
            placeByHeight(group, item.garmentType, shape.landmarks);
            const placed = worldPositions(group);
            const stats = drapeGarment(group, shape, {
              fit: item.fit, layer: 0, size: row, garmentType: item.garmentType,   // без подсказки legs: проверяем определение по геометрии
            });
            const draped = worldPositions(group);
            expect(draped.every(Number.isFinite)).toBe(true);
            const name = `${fig}__${itemId}__${variant}__${sizeName}`;
            fs.writeFileSync(path.join(OUT, `${name}.placed.bin`), Buffer.from(placed.buffer));
            fs.writeFileSync(path.join(OUT, `${name}.draped.bin`), Buffer.from(draped.buffer));
            if (!fs.existsSync(path.join(OUT, `${itemId}__${variant}.index.bin`))) {
              fs.writeFileSync(path.join(OUT, `${itemId}__${variant}.index.bin`), Buffer.from(indices(group).buffer));
            }
            meta.runs.push({
              name, figure: fig, kind, item: itemId, variant, size: sizeName, sizeRow: row,
              garmentType: item.garmentType, fit: item.fit, legsHint: item.legs || null, legsDetected: stats.legs ?? null,
              vertices: placed.length / 3, ms: stats.ms, pushed: stats.pushed, pulled: stats.pulled,
            });
          });
        });
      });
    });
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

    // брюки и юбки определяются по геометрии вещи так же, как задумано в манифесте
    meta.runs.filter((r) => r.kind === 'base' && r.legsHint).forEach((r) => {
      expect(`${r.name}: ${r.legsDetected}`).toBe(`${r.name}: ${r.legsHint}`);
    });
  });
});
