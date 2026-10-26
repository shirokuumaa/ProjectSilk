// server/utils/silhouettes.js
//
// Силуэт товара — фасон, который выбрал продавец: один из наших 8 шаблонов GarmentCode
// (research/patterns/templates.py) и ручки рукав/длина. По нему и по сетке строятся
// выкройки каждого размера (services/patternJobs.js).
// Тот же список — в client/src/utils/silhouettes.js; совпадение проверяет test/silhouettes.test.js.

export const SILHOUETTE_TEMPLATES = {
  dress: ['dress_fitted', 'dress_aline', 'dress_flared'],
  bottom: ['skirt_pencil', 'skirt_aline', 'skirt_flared'],
  top: ['top_fitted', 'top_loose'],
};

export const SLEEVES = ['none', 'short', '3/4', 'long'];
const SKIRT_LENGTHS = ['mini', 'knee', 'midi', 'maxi'];
export const LENGTHS = { dress: SKIRT_LENGTHS, bottom: SKIRT_LENGTHS, top: ['cropped', 'regular', 'long'] };
// как DEFAULT_KNOBS в templates.py
const DEFAULTS = { dress: { sleeve: 'short', length: 'knee' }, bottom: { length: 'knee' }, top: { sleeve: 'short', length: 'regular' } };

export const SILHOUETTE_ERROR = 'This silhouette does not match the garment type.';

/** Подходит ли силуэт к типу вещи. */
export function silhouetteFits(garmentType, silhouette) {
  return !!silhouette?.template && (SILHOUETTE_TEMPLATES[garmentType] || []).includes(silhouette.template);
}

/**
 * Силуэт из формы (строка JSON или объект) для типа вещи.
 * @returns {{ silhouette: object | null } | { error: string }} null — «None of these»
 */
export function parseSilhouette(raw, garmentType) {
  if (raw == null || raw === '' || raw === 'null') return { silhouette: null };
  let s = raw;
  if (typeof raw === 'string') {
    try { s = JSON.parse(raw); } catch { return { error: SILHOUETTE_ERROR }; }
  }
  if (!s) return { silhouette: null };
  if (!silhouetteFits(garmentType, s)) return { error: SILHOUETTE_ERROR };
  const knobs = { ...DEFAULTS[garmentType] };
  if ('sleeve' in knobs && s.sleeve != null) {
    if (!SLEEVES.includes(s.sleeve)) return { error: 'Sleeve must be sleeveless, short, 3/4 or long.' };
    knobs.sleeve = s.sleeve;
  }
  if (s.length != null) {
    if (!LENGTHS[garmentType].includes(s.length)) return { error: `Length must be one of: ${LENGTHS[garmentType].join(', ')}.` };
    knobs.length = s.length;
  }
  return { silhouette: { template: s.template, ...knobs } };
}
