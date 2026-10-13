// Сечения настоящего меша (JS) против калибровки (Python, scripts/avatar/calibrate.py):
// обхваты болванки на уровнях груди, талии и бёдер должны совпадать для тестовых фигур.
import fs from 'fs';
import path from 'path';
import calibration from '../data/avatarCalibration.json';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape, prepareBaseBody } from './baseBody';
import { _internal, proceduralBodyShape } from './bodyShape';
import { readBaseBody } from './testing/readGlb';

const GLB = path.join(__dirname, '../../public/models/base_avatar.glb');
const body = prepareBaseBody(readBaseBody(fs.readFileSync(GLB)));

const figures = Object.entries(calibration.validation.testFigures).filter(([, f]) => f.inRange);
const asProfile = (r) => ({
  heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips,
  shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam,
});

describe('meshBodyShape girths match the calibration', () => {
  test.each(figures)('%s', (name, fig) => {
    const solution = solveAvatar(asProfile(fig.requested));
    const shape = baseBodyShape(body, solution);
    const L = shape.levels;
    expect(shape.girthAt(L.chest) * 100).toBeCloseTo(fig.actual.bust, 0);
    expect(shape.girthAt(L.waist) * 100).toBeCloseTo(fig.actual.waist, 0);
    expect(shape.girthAt(L.hips) * 100).toBeCloseTo(fig.actual.hips, 0);
    expect(shape.landmarks.height * 100).toBeCloseTo(fig.actual.height, 0);
    expect(L.crotch * 100).toBeCloseTo(fig.actual.inseam, 0);
  });
});

test('mesh shape answers a radius for every region', () => {
  const shape = baseBodyShape(body, solveAvatar(asProfile(calibration.validation.testFigures.medium.requested)));
  const L = shape.levels;
  ['torso', 'legs', 'legL', 'legR'].forEach((region) => {
    const y = region === 'torso' ? L.waist : L.crotch - 0.2;
    const x = region === 'legR' ? -0.1 : 0.1;
    const s = shape.surfaceAt(y, x, 0, region);
    expect(s.r).toBeGreaterThan(0.03);
    expect(s.r).toBeLessThan(0.3);
  });
  expect(shape.arms).toHaveLength(2);
  shape.arms.forEach((a) => { expect(a.r1).toBeGreaterThan(0.02); expect(a.r1).toBeLessThan(0.08); });
});

test('procedural shape keeps BodyAvatar landmarks', () => {
  const shape = proceduralBodyShape({ heightCm: 170 });
  expect(shape.landmarks.chest).toBeCloseTo(1.7 * 0.72, 6);
  expect(shape.zone.low).toBeCloseTo(1.7 * 0.53 - 0.06, 6);
});

test('radius is positive at every level and angle of every region', () => {
  const shape = baseBodyShape(body, solveAvatar(asProfile(calibration.validation.testFigures.large.requested)));
  const L = shape.levels;
  ['torso', 'legs', 'legL', 'legR'].forEach((region) => {
    const [y0, y1] = region === 'torso' ? [L.crotch + 0.01, shape.landmarks.neck - 0.01] : [L.ankle + 0.01, L.crotch - 0.01];
    const dx = region === 'legL' ? 0.1 : region === 'legR' ? -0.1 : 0;
    for (let y = y0; y < y1; y += 0.01) {
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const { r } = shape.surfaceAt(y, Math.cos(a) * 0.5 + dx, Math.sin(a) * 0.5, region);
        expect(r).toBeGreaterThan(0.01);
        expect(r).toBeLessThan(0.4);
      }
    }
  });
});

test('one-pass polar table equals brute-force ray casting', () => {
  const { hull, polarTable } = _internal;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 20; trial++) {
    const pts = [];
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      pts.push(rnd() * 0.4 - 0.2 + Math.cos(a) * 0.15 * r, Math.sin(a) * (0.05 + rnd() * 0.1) * r);
    }
    const poly = hull(pts);
    const t = polarTable(poly);
    for (let k = 0; k < 72; k++) {
      const ang = (k / 72) * Math.PI * 2;
      let best = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i];
        const [x1, z1] = poly[(i + 1) % poly.length];
        const ex = x1 - x0; const ez = z1 - z0;
        const den = Math.cos(ang) * ez - Math.sin(ang) * ex;
        if (Math.abs(den) < 1e-12) continue;
        const s = ((x0 - t.cx) * ez - (z0 - t.cz) * ex) / den;
        const u = ((x0 - t.cx) * Math.sin(ang) - (z0 - t.cz) * Math.cos(ang)) / den;
        if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, s);
      }
      expect(t.r[k]).toBeCloseTo(best, 5);
    }
  }
});
