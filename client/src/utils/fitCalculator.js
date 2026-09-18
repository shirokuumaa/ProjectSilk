// client/src/utils/fitCalculator.js
//
// Fit maths. Pure arithmetic, no dependencies — runs in the browser and in
// Node alike (copy this file to server/utils/ unchanged if it is ever needed
// server-side).
//
// Core idea: ease = garment girth − body girth.
//   ease < 0   → will not close
//   ease ~ 0   → skin tight
//   ease 4-8   → sits well
//   ease > 15  → hangs loose
//
// NOTE: every string in this file is shown to the customer. Keep them in
// English and keep them short — they appear inside small cards and chips.

/** Measurements that decide fit, in priority order. */
export const KEY_MEASUREMENTS = ['chest', 'waist', 'hips'];

export const MEASUREMENT_LABELS = {
  chest: 'bust',
  waist: 'waist',
  hips: 'hips',
  length: 'length',
  sleeve: 'sleeve',
};

/**
 * Target ease per cut, in centimetres.
 * min — tighter than this pinches, ideal — as designed, max — looser hangs.
 */
const EASE_TARGETS = {
  tight:   { min: -2, ideal: 2,  max: 6 },   // bodycon, leggings, fitted dress
  regular: { min: 2,  ideal: 6,  max: 14 },  // tee, shirt, everyday dress
  loose:   { min: 8,  ideal: 16, max: 30 },  // oversized, coat, hoodie
};

/** Verdict levels, worst to best. */
export const FIT_LEVELS = {
  TOO_TIGHT:  'too_tight',
  TIGHT:      'tight',
  GOOD:       'good',
  LOOSE:      'loose',
  TOO_LOOSE:  'too_loose',
};

const LEVEL_TEXT = {
  too_tight: 'will not close',
  tight:     'snug',
  good:      'good fit',
  loose:     'roomy',
  too_loose: 'hangs loose',
};

const LEVEL_COLOR = {
  too_tight: '#e03131',
  tight:     '#f08c00',
  good:      '#2f9e44',
  loose:     '#f08c00',
  too_loose: '#e03131',
};

/**
 * Score a single measurement.
 * @param {number} bodyValue    body girth, cm
 * @param {number} garmentValue garment girth, cm
 * @param {string} fit          'tight' | 'regular' | 'loose'
 * @param {number} stretch      fabric stretch, % (0 = no stretch)
 */
export function evaluateMeasurement(bodyValue, garmentValue, fit = 'regular', stretch = 0) {
  if (bodyValue == null || garmentValue == null) return null;

  const target = EASE_TARGETS[fit] || EASE_TARGETS.regular;
  const ease = garmentValue - bodyValue;

  // Stretch fabric tolerates negative ease. Comfortable stretch is roughly
  // half of what the mill claims.
  const stretchAllowance = garmentValue * (stretch / 100) * 0.5;
  const effectiveEase = ease + stretchAllowance;

  let level;
  if (effectiveEase < target.min - 3)        level = FIT_LEVELS.TOO_TIGHT;
  else if (effectiveEase < target.min)       level = FIT_LEVELS.TIGHT;
  else if (effectiveEase <= target.max)      level = FIT_LEVELS.GOOD;
  else if (effectiveEase <= target.max + 8)  level = FIT_LEVELS.LOOSE;
  else                                       level = FIT_LEVELS.TOO_LOOSE;

  return {
    ease: Math.round(ease * 10) / 10,
    effectiveEase: Math.round(effectiveEase * 10) / 10,
    level,
    text: LEVEL_TEXT[level],
    color: LEVEL_COLOR[level],
    // distance from ideal — used to pick the best size
    deviation: Math.abs(effectiveEase - target.ideal),
  };
}

/**
 * Score one whole size.
 * @param {object} body body profile { chest, waist, hips, ... }
 * @param {object} size size chart row { size, chest, waist, hips, fit, stretch }
 */
export function evaluateSize(body, size) {
  const fit = size.fit || 'regular';
  const stretch = size.stretch ?? 0;

  const parts = {};
  let worst = FIT_LEVELS.GOOD;
  let totalDeviation = 0;
  let counted = 0;

  const severity = { too_tight: 4, too_loose: 3, tight: 2, loose: 1, good: 0 };

  for (const key of KEY_MEASUREMENTS) {
    const result = evaluateMeasurement(body[key], size[key], fit, stretch);
    if (!result) continue;
    parts[key] = result;
    totalDeviation += result.deviation;
    counted += 1;
    if (severity[result.level] > severity[worst]) worst = result.level;
  }

  if (counted === 0) return null;

  return {
    size: size.size,
    parts,
    level: worst,
    text: LEVEL_TEXT[worst],
    color: LEVEL_COLOR[worst],
    score: totalDeviation / counted, // lower is better
    wearable: worst !== FIT_LEVELS.TOO_TIGHT && worst !== FIT_LEVELS.TOO_LOOSE,
  };
}

/**
 * Pick a size and explain the choice.
 *
 * @returns {{
 *   recommended: object|null,
 *   chosen: object|null,
 *   all: Array,
 *   message: string,
 *   shouldWarn: boolean
 * }}
 */
export function findBestSize(body, sizeChart = [], chosen = null) {
  if (!body || !sizeChart.length) {
    return {
      recommended: null, chosen: null, all: [],
      message: 'Add your measurements to see a size recommendation',
      shouldWarn: false,
    };
  }

  const all = sizeChart.map((size) => evaluateSize(body, size)).filter(Boolean);

  if (!all.length) {
    return {
      recommended: null, chosen: null, all: [],
      message: 'The seller did not enter measurements for this item',
      shouldWarn: false,
    };
  }

  // Best = wearable with the smallest deviation from ideal.
  // If nothing is wearable, take the least bad.
  const wearable = all.filter((s) => s.wearable);
  const pool = wearable.length ? wearable : all;
  const recommended = pool.reduce((a, b) => (a.score <= b.score ? a : b));

  const chosenResult = chosen ? all.find((s) => s.size === chosen) : null;

  let message;
  let shouldWarn = false;

  if (!wearable.length) {
    message = `No size will really work — ${recommended.size} is the closest`;
    shouldWarn = true;
  } else if (!chosenResult) {
    message = `Your size is ${recommended.size}`;
  } else if (chosenResult.size === recommended.size) {
    message = `${chosenResult.size} is your size — it will sit well`;
  } else if (!chosenResult.wearable) {
    message = `${chosenResult.size} will not work: ${worstPart(chosenResult)}. Take ${recommended.size}`;
    shouldWarn = true;
  } else {
    message = `${chosenResult.size} will go on, but ${worstPart(chosenResult)}. ${recommended.size} fits better`;
    shouldWarn = true;
  }

  return { recommended, chosen: chosenResult, all, message, shouldWarn };
}

/** Which measurement spoils the fit most — used in the hint text. */
function worstPart(sizeResult) {
  let worstKey = null;
  let worstDev = -1;

  for (const [key, part] of Object.entries(sizeResult.parts)) {
    if (part.level === FIT_LEVELS.GOOD) continue;
    if (part.deviation > worstDev) {
      worstDev = part.deviation;
      worstKey = key;
    }
  }

  if (!worstKey) return 'the fit is not ideal';

  const part = sizeResult.parts[worstKey];
  const label = MEASUREMENT_LABELS[worstKey] || worstKey;
  const cm = Math.abs(part.ease);

  if (part.level === FIT_LEVELS.TOO_TIGHT) return `it is ${cm.toFixed(0)} cm short at the ${label}`;
  if (part.level === FIT_LEVELS.TIGHT)     return `it will be snug at the ${label}`;
  if (part.level === FIT_LEVELS.TOO_LOOSE) return `there is ${cm.toFixed(0)} cm too much at the ${label}`;
  return `it is a little loose at the ${label}`;
}

/**
 * Data for highlighting stress zones on the 3D avatar.
 * Returns { chest: '#e03131', waist: '#2f9e44', ... }
 */
export function getStressMap(sizeResult) {
  if (!sizeResult) return {};
  const map = {};
  for (const [key, part] of Object.entries(sizeResult.parts)) {
    map[key] = part.color;
  }
  return map;
}
