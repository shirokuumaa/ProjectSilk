// client/src/utils/fitCalculator.js
//
// Расчёт посадки одежды по обмерам. Чистая арифметика, без зависимостей.
// Работает и в браузере, и в Node (если понадобится на сервере — скопировать
// этот файл в server/utils/ без изменений).
//
// Основная идея: прибавка на свободу (ease) = обхват изделия − обхват тела.
//   ease < 0  → не сходится
//   ease ~ 0  → в обтяжку
//   ease 4-8  → сидит нормально
//   ease > 15 → висит мешком

/** Ключевые обмеры, по которым судим о посадке. Порядок = приоритет. */
export const KEY_MEASUREMENTS = ['chest', 'waist', 'hips'];

export const MEASUREMENT_LABELS = {
  chest: 'грудь',
  waist: 'талия',
  hips: 'бёдра',
  length: 'длина',
  sleeve: 'рукав',
};

/**
 * Целевые прибавки по типу кроя (см).
 * min — меньше этого жмёт, ideal — как задумано, max — больше этого висит.
 */
const EASE_TARGETS = {
  tight:   { min: -2, ideal: 2,  max: 6 },   // облегающее: боди, лосины, платье в обтяжку
  regular: { min: 2,  ideal: 6,  max: 14 },  // обычный крой: футболка, рубашка, платье
  loose:   { min: 8,  ideal: 16, max: 30 },  // свободный: оверсайз, пальто, худи
};

/** Уровни вердикта от худшего к лучшему. */
export const FIT_LEVELS = {
  TOO_TIGHT:  'too_tight',
  TIGHT:      'tight',
  GOOD:       'good',
  LOOSE:      'loose',
  TOO_LOOSE:  'too_loose',
};

const LEVEL_TEXT = {
  too_tight: 'не сходится',
  tight:     'будет туго',
  good:      'сидит хорошо',
  loose:     'свободно',
  too_loose: 'висит мешком',
};

const LEVEL_COLOR = {
  too_tight: '#e03131',
  tight:     '#f08c00',
  good:      '#2f9e44',
  loose:     '#f08c00',
  too_loose: '#e03131',
};

/**
 * Оценка одного обмера.
 * @param {number} bodyValue    обхват тела, см
 * @param {number} garmentValue обхват изделия, см
 * @param {string} fit          'tight' | 'regular' | 'loose'
 * @param {number} stretch      эластичность ткани, % (0 = не тянется)
 */
export function evaluateMeasurement(bodyValue, garmentValue, fit = 'regular', stretch = 0) {
  if (bodyValue == null || garmentValue == null) return null;

  const target = EASE_TARGETS[fit] || EASE_TARGETS.regular;
  const ease = garmentValue - bodyValue;

  // Эластичная ткань допускает отрицательную прибавку.
  // Комфортно тянется примерно на половину заявленной эластичности.
  const stretchAllowance = garmentValue * (stretch / 100) * 0.5;
  const effectiveEase = ease + stretchAllowance;

  let level;
  if (effectiveEase < target.min - 3)      level = FIT_LEVELS.TOO_TIGHT;
  else if (effectiveEase < target.min)     level = FIT_LEVELS.TIGHT;
  else if (effectiveEase <= target.max)    level = FIT_LEVELS.GOOD;
  else if (effectiveEase <= target.max + 8) level = FIT_LEVELS.LOOSE;
  else                                      level = FIT_LEVELS.TOO_LOOSE;

  return {
    ease: Math.round(ease * 10) / 10,
    effectiveEase: Math.round(effectiveEase * 10) / 10,
    level,
    text: LEVEL_TEXT[level],
    color: LEVEL_COLOR[level],
    // расстояние от идеала — используется для выбора лучшего размера
    deviation: Math.abs(effectiveEase - target.ideal),
  };
}

/**
 * Оценка одного размера целиком.
 * @param {object} body    профиль тела { chest, waist, hips, ... }
 * @param {object} size    строка размерной сетки { size, chest, waist, hips, fit, stretch }
 */
export function evaluateSize(body, size) {
  const fit = size.fit || 'regular';
  const stretch = size.stretch ?? 0;

  const parts = {};
  let worst = FIT_LEVELS.GOOD;
  let totalDeviation = 0;
  let counted = 0;

  const severity = {
    too_tight: 4, too_loose: 3, tight: 2, loose: 1, good: 0,
  };

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
    score: totalDeviation / counted, // меньше = лучше
    wearable: worst !== FIT_LEVELS.TOO_TIGHT && worst !== FIT_LEVELS.TOO_LOOSE,
  };
}

/**
 * Главная функция: подобрать размер и объяснить решение.
 *
 * @param {object} body      профиль тела
 * @param {Array}  sizeChart размерная сетка товара
 * @param {string} chosen    размер, выбранный покупателем (опционально)
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
      message: 'Укажите свои обмеры, чтобы увидеть рекомендацию по размеру',
      shouldWarn: false,
    };
  }

  const all = sizeChart
    .map((size) => evaluateSize(body, size))
    .filter(Boolean);

  if (!all.length) {
    return {
      recommended: null, chosen: null, all: [],
      message: 'Продавец не указал обмеры этой вещи',
      shouldWarn: false,
    };
  }

  // Лучший = носибельный с минимальным отклонением от идеала.
  // Если носибельных нет — берём наименее плохой.
  const wearable = all.filter((s) => s.wearable);
  const pool = wearable.length ? wearable : all;
  const recommended = pool.reduce((a, b) => (a.score <= b.score ? a : b));

  const chosenResult = chosen ? all.find((s) => s.size === chosen) : null;

  let message;
  let shouldWarn = false;

  if (!wearable.length) {
    message = `К сожалению, ни один размер не подойдёт — ближе всего ${recommended.size}`;
    shouldWarn = true;
  } else if (!chosenResult) {
    message = `Ваш размер — ${recommended.size}`;
  } else if (chosenResult.size === recommended.size) {
    message = `${chosenResult.size} — ваш размер, сядет хорошо`;
  } else if (!chosenResult.wearable) {
    const problem = worstPart(chosenResult);
    message = `${chosenResult.size} не подойдёт: ${problem}. Возьмите ${recommended.size}`;
    shouldWarn = true;
  } else {
    const problem = worstPart(chosenResult);
    message = `${chosenResult.size} наденется, но ${problem}. Лучше сядет ${recommended.size}`;
    shouldWarn = true;
  }

  return { recommended, chosen: chosenResult, all, message, shouldWarn };
}

/** Какой обмер портит посадку сильнее всего — для текста подсказки. */
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

  if (!worstKey) return 'посадка не идеальна';

  const part = sizeResult.parts[worstKey];
  const label = MEASUREMENT_LABELS[worstKey] || worstKey;
  const cm = Math.abs(part.ease);

  if (part.level === FIT_LEVELS.TOO_TIGHT) return `в ${label} не хватает ${cm.toFixed(0)} см`;
  if (part.level === FIT_LEVELS.TIGHT)     return `в ${label} будет туго`;
  if (part.level === FIT_LEVELS.TOO_LOOSE) return `в ${label} лишних ${cm.toFixed(0)} см`;
  return `в ${label} свободновато`;
}

/**
 * Данные для подсветки зон натяжения на 3D-аватаре.
 * Возвращает { chest: '#e03131', waist: '#2f9e44', ... }
 */
export function getStressMap(sizeResult) {
  if (!sizeResult) return {};
  const map = {};
  for (const [key, part] of Object.entries(sizeResult.parts)) {
    map[key] = part.color;
  }
  return map;
}
