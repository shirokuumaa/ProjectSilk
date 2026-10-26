// client/src/utils/silhouettes.js
//
// Силуэты, из которых продавец выбирает фасон: наши 11 шаблонов GarmentCode
// (research/patterns/templates.py). По силуэту и размерной сетке сервер строит
// выкройку каждого размера (scripts/garments/patterns_job.py).
// Картинки — public/silhouettes/<template>.png (research/patterns/render_silhouettes.py):
// наши шаблоны на нашей болванке, без чужих фото.
// Тот же список — в server/utils/silhouettes.js; совпадение всех трёх проверяет
// server/test/silhouettes.test.js.

export const SILHOUETTES = {
  dress: [
    { template: 'dress_fitted', label: 'Fitted', hint: 'Darted bodice, straight skirt' },
    { template: 'dress_aline', label: 'A-line', hint: 'Straight bodice, A-line skirt' },
    { template: 'dress_flared', label: 'Flared', hint: 'Full circle skirt' },
  ],
  // юбки и брюки; шорт среди шаблонов нет
  bottom: [
    { template: 'skirt_pencil', label: 'Pencil skirt', hint: 'Straight, close to the hips' },
    { template: 'skirt_aline', label: 'A-line skirt', hint: 'Widens towards the hem' },
    { template: 'skirt_flared', label: 'Flared skirt', hint: 'Full circle skirt' },
    { template: 'pants_straight', label: 'Straight trousers', hint: 'Straight leg' },
    { template: 'pants_slim', label: 'Slim trousers', hint: 'Narrows towards the ankle' },
    { template: 'pants_wide', label: 'Wide-leg trousers', hint: 'Wide from hip to hem' },
  ],
  top: [
    { template: 'top_fitted', label: 'Fitted top', hint: 'Close to the body' },
    { template: 'top_loose', label: 'Straight top', hint: 'Straight, loose cut' },
  ],
};

export const SLEEVES = [
  { value: 'none', label: 'Sleeveless' },
  { value: 'short', label: 'Short' },
  { value: '3/4', label: '3/4' },
  { value: 'long', label: 'Long' },
];

const SKIRT_LENGTHS = [
  { value: 'mini', label: 'Mini' },
  { value: 'knee', label: 'Knee' },
  { value: 'midi', label: 'Midi' },
  { value: 'maxi', label: 'Maxi' },
];

export const LENGTHS = {
  dress: SKIRT_LENGTHS,
  bottom: SKIRT_LENGTHS,
  top: [
    { value: 'cropped', label: 'Cropped' },
    { value: 'regular', label: 'Regular' },
    { value: 'long', label: 'Long' },
  ],
};

// брюки — тоже «низ», но со своими длинами (LENGTH["pants"] в templates.py)
const PANTS_LENGTHS = [
  { value: 'cropped', label: 'Cropped (ankle)' },
  { value: 'full', label: 'Full length' },
];
const isPants = (template) => typeof template === 'string' && template.startsWith('pants_');

// как DEFAULT_KNOBS в templates.py
export const DEFAULT_KNOBS = {
  dress: { sleeve: 'short', length: 'knee' },
  bottom: { length: 'knee' },
  top: { sleeve: 'short', length: 'regular' },
};

/** Длины, из которых выбирают для шаблона этого типа. */
export const lengthsFor = (garmentType, template) => (isPants(template) ? PANTS_LENGTHS : LENGTHS[garmentType] || []);

export const silhouettesFor = (garmentType) => SILHOUETTES[garmentType] || [];
export const hasSleeve = (garmentType) => garmentType === 'dress' || garmentType === 'top';
export const silhouetteImage = (template) => `/silhouettes/${template}.png`;

/** Силуэт с ручками по умолчанию для типа; null — у типа нет силуэтов. */
export function silhouetteWith(garmentType, template) {
  if (!silhouettesFor(garmentType).some((s) => s.template === template)) return null;
  return { template, ...(isPants(template) ? { length: 'full' } : DEFAULT_KNOBS[garmentType]) };
}

/** Силуэт ещё подходит к типу? (тип могли сменить после выбора) */
export function silhouetteFits(garmentType, silhouette) {
  return !!silhouette && silhouettesFor(garmentType).some((s) => s.template === silhouette.template);
}
