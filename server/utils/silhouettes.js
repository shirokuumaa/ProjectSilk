// server/utils/silhouettes.js
//
// Силуэт товара — фасон, который выбрал продавец: один из наших 13 шаблонов GarmentCode
// (research/patterns/templates.py) и ручки рукав/длина. По нему и по сетке строятся
// выкройки каждого размера (services/patternJobs.js).
// Тот же список — в client/src/utils/silhouettes.js; совпадение проверяет test/silhouettes.test.js.

export const SILHOUETTE_TEMPLATES = {
  dress: ['dress_fitted', 'dress_aline', 'dress_flared'],
  bottom: ['skirt_pencil', 'skirt_aline', 'skirt_flared', 'pants_straight', 'pants_slim', 'pants_wide'],
  top: ['top_fitted', 'top_loose'],
  // закрытая оболочка с лацканами и длинным рукавом (templates.py: в GarmentCode нет разреза спереди)
  outerwear: ['jacket', 'coat'],
};

export const SLEEVES = ['none', 'short', '3/4', 'long'];
const SKIRT_LENGTHS = ['mini', 'knee', 'midi', 'maxi'];
export const LENGTHS = {
  dress: SKIRT_LENGTHS, bottom: SKIRT_LENGTHS, top: ['cropped', 'regular', 'long'], outerwear: ['hip', 'thigh', 'knee'],
};
// брюки — тоже «низ», но со своими длинами (LENGTH["pants"] в templates.py)
const PANTS_LENGTHS = ['cropped', 'full'];
const isPants = (template) => typeof template === 'string' && template.startsWith('pants_');
// как DEFAULT_KNOBS в templates.py (рукав верхней одежды всегда длинный — его не выбирают)
const DEFAULTS = {
  dress: { sleeve: 'short', length: 'knee' }, bottom: { length: 'knee' }, top: { sleeve: 'short', length: 'regular' },
  outerwear: { length: 'hip' },
};
// свои ручки шаблона, как "knobs" у шаблона в templates.py
const TEMPLATE_DEFAULTS = { coat: { length: 'knee' } };
const defaultsFor = (garmentType, template) => (isPants(template)
  ? { length: 'full' } : { ...DEFAULTS[garmentType], ...TEMPLATE_DEFAULTS[template] });

/** Длины, из которых выбирают для шаблона этого типа. */
export const lengthsFor = (garmentType, template) => (isPants(template) ? PANTS_LENGTHS : LENGTHS[garmentType]);

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
  const knobs = defaultsFor(garmentType, s.template);
  if ('sleeve' in knobs && s.sleeve != null) {
    if (!SLEEVES.includes(s.sleeve)) return { error: 'Sleeve must be sleeveless, short, 3/4 or long.' };
    knobs.sleeve = s.sleeve;
  }
  if (s.length != null) {
    const lengths = lengthsFor(garmentType, s.template);
    if (!lengths.includes(s.length)) return { error: `Length must be one of: ${lengths.join(', ')}.` };
    knobs.length = s.length;
  }
  return { silhouette: { template: s.template, ...knobs } };
}
