// client/src/utils/garmentTemplates.js
//
// Вещь без своей 3D-модели всё равно можно примерить: надеваем общий шаблон
// того же типа (футболка, джинсы, юбка, платье…) и прижимаем его к фигуре
// вариантом B (utils/garmentDrape.js) по размерной сетке ЭТОЙ вещи — так
// видно, как сидит выбранный размер. Это форма вещи, а не её вид: цвет и
// фасон шаблонные, покупателю это поясняется.
//
// Шаблоны — одежда MPFB/MakeHuman (CC0), посаженная на болванку
// (public/models/test-garments, scripts/garments/export_test_garments.py);
// платье — наша заготовка из генерации по фото (public/uploads/stub/dress.glb).
// Для верхней одежды, обуви и аксессуаров шаблонов нет.

const DIR = '/models/test-garments';

const TEMPLATES = {
  tee:      { label: 'tee',      legs: null },
  croptop:  { label: 'crop top', legs: null },
  blouse:   { label: 'blouse',   legs: null },
  jeans:    { label: 'trousers', legs: 'split' },
  shorts:   { label: 'shorts',   legs: 'split' },
  leggings: { label: 'leggings', legs: 'split' },
  skirt:    { label: 'skirt',    legs: 'joined' },
  dress:    { label: 'dress',    legs: 'joined', url: '/uploads/stub/dress.glb' },
};

export const GARMENT_TYPES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

/** Тип по явному слову в категории (старые товары гардероба); иначе — не угадываем. */
function typeFromCategory(category = '') {
  const c = String(category).toLowerCase();
  if (c.includes('dress')) return 'dress';
  if (c.includes('bottom') || c.includes('pant') || c.includes('skirt') || c.includes('jean')) return 'bottom';
  if (c.includes('shoe') || c.includes('boot')) return 'shoes';
  if (c.includes('coat') || c.includes('jacket') || c.includes('outer')) return 'outerwear';
  return null;
}

/**
 * Тип вещи для примерки: тип товара, иначе явное слово в категории.
 * null — тип не задан: вещь не надевается (раньше такие считались верхом,
 * и платье садилось на фигуру футболкой).
 */
export function garmentTypeOf(item) {
  if (GARMENT_TYPES.includes(item?.garmentType)) return item.garmentType;
  return typeFromCategory(item?.category);
}

/**
 * Почему вещи нет на фигуре — словами покупателя; null — вещь надевается.
 */
export function offFigureReason(item) {
  const name = item?.name || item?.title || 'This item';
  if (!garmentTypeOf(item)) {
    return `${name}: type not set. The seller has not said what kind of item this is, so it is not shown on the figure.`;
  }
  return null;
}

function pick(item) {
  const type = garmentTypeOf(item);
  const text = `${item?.name || ''} ${item?.title || ''} ${item?.category || ''}`.toLowerCase();

  if (type === 'top') {
    if (/crop/.test(text)) return 'croptop';
    if (/blouse|shirt(?!s)/.test(text) && !/t-?shirt/.test(text)) return 'blouse';
    return 'tee';
  }
  if (type === 'bottom') {
    if (item?.legs === 'joined' || /skirt/.test(text)) return 'skirt';
    if (/short/.test(text)) return 'shorts';
    if (/legging/.test(text)) return 'leggings';
    return 'jeans';
  }
  if (type === 'dress') return 'dress';
  return null; // outerwear, shoes, accessory
}

/**
 * Шаблон для вещи без 3D-модели.
 * @returns {{ id, url, label, legs } | null} null — шаблона для такого типа нет
 */
export function templateFor(item) {
  if (!item || item.model3d) return null;
  const id = pick(item);
  if (!id) return null;
  const { url = `${DIR}/${id}.glb`, ...rest } = TEMPLATES[id];
  return { id, url, ...rest };
}
