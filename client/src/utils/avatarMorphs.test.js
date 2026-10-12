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

  test('the four test figures are in range, plus is not', () => {
    const inRange = figures.filter(([, fig]) => solveAvatar(asProfile(fig.requested)).inRange).map(([n]) => n);
    expect(inRange).toEqual(['petite', 'small', 'medium', 'large']);
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
