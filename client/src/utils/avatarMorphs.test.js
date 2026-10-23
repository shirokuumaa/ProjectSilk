// Подбор морфов в браузере должен совпадать с Python (scripts/avatar/calibrate.py):
// avatarCalibration.json хранит, какие значения морфов Python нашёл для
// тестовых фигур и сколько они дали на настоящем меше.
import calibration from '../data/avatarCalibration.json';
import { keyWeights, profileTargets, solveAvatar, solveControls } from './avatarMorphs';

const figures = Object.entries(calibration.validation.testFigures);

describe('solveControls matches the Python solver', () => {
  test.each(figures)('%s', (name, fig) => {
    const { controls } = solveControls(fig.requested, calibration);
    calibration.controls.forEach((c, i) => {
      expect(controls[i]).toBeCloseTo(fig.controls[c], 3);
    });
  });
});

describe('solveAvatar', () => {
  const asProfile = (r) => ({
    heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips,
    shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam,
  });

  test.each(figures)('%s: in-range flag as in calibration', (name, fig) => {
    expect(solveAvatar(asProfile(fig.requested), calibration).inRange).toBe(fig.inRange);
  });

  test('every test figure up to 132/120/140 is in range; 140/130/150 with all seven measures is not', () => {
    const inRange = figures.filter(([, fig]) => solveAvatar(asProfile(fig.requested)).inRange).map(([n]) => n);
    expect(inRange).toEqual(['petite', 'small', 'medium', 'large', 'plus', 'plus2']);
  });

  test('large sizes with the four required measures: up to 140/130/150 within tolerance', () => {
    [
      { heightCm: 166, chest: 125, waist: 110, hips: 132 },
      { heightCm: 166, chest: 140, waist: 130, hips: 150 },
      { heightCm: 176, chest: 140, waist: 130, hips: 150 },
      { heightCm: 158, chest: 128, waist: 118, hips: 138 },
    ].forEach((p) => {
      const r = solveAvatar(p);
      expect(r.inRange).toBe(true);
      Object.values(r.residuals).forEach((v) => expect(Math.abs(v)).toBeLessThanOrEqual(calibration.range.acceptResidualCm));
    });
  });

  test('far beyond the calibrated range: out of range (BodyAvatar)', () => {
    expect(solveAvatar({ heightCm: 166, chest: 170, waist: 160, hips: 180 }).inRange).toBe(false);
  });

  test('missing required measurement → out of range', () => {
    const r = solveAvatar({ heightCm: 166, chest: 92, waist: 74 });
    expect(r.inRange).toBe(false);
    expect(r.missing).toEqual(['hips']);
  });

  test('weights map to the 16 GLB keys, only one key of a pair is on', () => {
    const r = solveAvatar(asProfile(calibration.validation.testFigures.medium.requested));
    expect(Object.keys(r.weights)).toEqual(calibration.keys);
    calibration.controls.forEach((c) => {
      expect(r.weights[`${c}_incr`] * r.weights[`${c}_decr`]).toBe(0);
    });
  });
});

test('profileTargets ignores empty and non-numeric fields', () => {
  expect(profileTargets({ heightCm: 160, chest: '', waist: 'x', hips: 0 })).toMatchObject({
    height: 160, bust: null, waist: null, hips: null,
  });
});

test('keyWeights splits sign into incr/decr', () => {
  expect(keyWeights([0.5, -0.25])).toEqual([0.5, 0, 0, 0.25]);
});

describe('large-size morphs only when the original eight are not enough', () => {
  const big = calibration.solver.stage2.controls;

  test.each(['petite', 'small', 'medium', 'large'])('%s: solved without them, as before', (name) => {
    const r = solveAvatar(asProfileOf(name));
    big.forEach((c) => expect(r.controls[c]).toBe(0));
  });

  test('plus: they are used, and the figure is within tolerance', () => {
    const r = solveAvatar({ heightCm: 166, chest: 125, waist: 110, hips: 132 });
    expect(big.some((c) => r.controls[c] > 0)).toBe(true);
    expect(r.inRange).toBe(true);
  });
});

function asProfileOf(name) {
  const r = calibration.validation.testFigures[name].requested;
  return { heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips,
    shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam };
}
