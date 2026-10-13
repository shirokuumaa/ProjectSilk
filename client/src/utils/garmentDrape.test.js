// Регрессия: подгонка вещи под процедурное тело (BodyAvatar) не должна меняться.
// Эталон снят с кода до варианта B (подгонка по сечениям меша болванки):
//   UPDATE_DRAPE_BASELINE=1 CI=true npx react-scripts test --watchAll=false src/utils/garmentDrape.test.js
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { drapeGarment } from './garmentDrape';

const FIXTURE = path.join(__dirname, '__fixtures__', 'drapeBaseline.json');

/** Детерминированная «труба» с выступами: часть вершин внутри тела, часть далеко. */
function syntheticGarment() {
  const pts = [];
  for (let j = 0; j <= 40; j++) {
    const y = 0.75 + j * 0.02;
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const r = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(3 * t + j * 0.7));
      pts.push(Math.cos(t) * r, y, Math.sin(t) * r * 0.8);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry));
  return root;
}

const CASES = [
  { profile: { heightCm: 170, chest: 92, waist: 76, hips: 98 }, opts: { fit: 'regular', layer: 0 } },
  { profile: { heightCm: 158, chest: 84, waist: 66, hips: 90 }, opts: { fit: 'tight', layer: 1 } },
  { profile: { heightCm: 176, chest: 108, waist: 92, hips: 116, shoulderWidth: 44 }, opts: { fit: 'loose', layer: 0 } },
];

function run({ profile, opts }) {
  const root = syntheticGarment();
  const { ms, ...stats } = drapeGarment(root, profile, opts);   // время — не часть результата
  const pos = root.children[0].geometry.attributes.position.array;
  return { stats, positions: Array.from(pos, (v) => Math.round(v * 1e6) / 1e6) };
}

describe('drapeGarment on the procedural body (BodyAvatar path)', () => {
  if (process.env.UPDATE_DRAPE_BASELINE) {
    test('write baseline', () => {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify(CASES.map(run)));
    });
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

  test.each(CASES.map((c, i) => [i, c]))('case %i matches the baseline', (i, c) => {
    const got = run(c);
    expect(got.stats).toEqual(baseline[i].stats);
    let maxDiff = 0;
    got.positions.forEach((v, k) => { maxDiff = Math.max(maxDiff, Math.abs(v - baseline[i].positions[k])); });
    expect(maxDiff).toBeLessThan(1e-5);
  });
});
