// client/src/utils/catalogFilter.js
//
// Поиск и фильтры каталога (витрина): текст по названию, описанию, магазину, типу и составу;
// раздел (тип вещи); цена от–до; размеры; «Fits me» — только вещи, у которых есть размер,
// подходящий фигуре покупателя и не распроданный; «In stock». Всё в адресе (?q=&type=&min=…),
// чтобы фильтр можно было отправить ссылкой и вернуться «назад».
// Каталог пилота маленький — считаем в браузере; при росте — тот же разбор на сервере.

import { findBestSize, sizeChartOf } from './fitCalculator';
import { garmentTypeOf } from './garmentTemplates';
import { isProfileComplete } from './bodyProfileApi';

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

/** Порядок размеров: буквенные по росту, потом числовые, потом остальные по алфавиту. */
export function compareSizes(a, b) {
  const ia = LETTER_SIZES.indexOf(String(a).toUpperCase());
  const ib = LETTER_SIZES.indexOf(String(b).toUpperCase());
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

/** Все размеры каталога — для фильтра. */
export const sizesOf = (products) =>
  [...new Set((products || []).flatMap((p) => (p.sizeChart || []).map((r) => r.size)))].sort(compareSizes);

const inStockRow = (row) => row?.stock !== 0;

/** Есть ли у вещи размер, который садится на фигуру покупателя и не распродан. */
export function fitsBuyer(product, profile) {
  if (!isProfileComplete(profile)) return false;
  const chart = sizeChartOf(product);
  if (!chart.length) return false;   // без сетки посадку не посчитать
  const stock = new Map((product.sizeChart || []).map((r) => [r.size, r.stock]));
  return findBestSize(profile, chart).all.some((r) => r.wearable && stock.get(r.size) !== 0);
}

/** Текст для поиска. */
const haystack = (p) => [
  p.title, p.name, p.description, p.category, p.store, garmentTypeOf(p),
  ...(p.composition || []).map((c) => c.fibre),
].filter(Boolean).join(' ').toLowerCase();

/** Фильтры из адреса. */
export function filtersFromParams(params) {
  const num = (k) => {
    const v = params.get(k);
    const n = v === null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    q: (params.get('q') || '').trim(),
    type: params.get('type') || '',
    min: num('min'),
    max: num('max'),
    sizes: (params.get('size') || '').split(',').map((s) => s.trim()).filter(Boolean),
    fitsMe: params.get('fits') === '1',
    inStock: params.get('stock') === '1',
    sort: params.get('sort') || 'new',
  };
}

/** Сколько фильтров включено (кроме поиска, раздела и сортировки) — для «Clear filters». */
export const activeFilterCount = (f) =>
  (f.min !== null ? 1 : 0) + (f.max !== null ? 1 : 0) + (f.sizes.length ? 1 : 0) + (f.fitsMe ? 1 : 0) + (f.inStock ? 1 : 0);

/** Каталог после поиска, фильтров и сортировки. */
export function filterCatalog(products, f, profile) {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (products || []).filter((p) => {
    if (f.type && garmentTypeOf(p) !== f.type) return false;
    const price = Number(p.price) || 0;
    if (f.min !== null && price < f.min) return false;
    if (f.max !== null && price > f.max) return false;
    const rows = p.sizeChart || [];
    if (f.sizes.length && !rows.some((r) => f.sizes.includes(r.size) && (!f.inStock || inStockRow(r)))) return false;
    if (f.inStock && rows.length && !rows.some(inStockRow)) return false;
    if (f.fitsMe && !fitsBuyer(p, profile)) return false;
    if (words.length) {
      const hay = haystack(p);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === 'price-asc') return [...list].sort((a, b) => (a.price || 0) - (b.price || 0));
  if (f.sort === 'price-desc') return [...list].sort((a, b) => (b.price || 0) - (a.price || 0));
  return list;
}
