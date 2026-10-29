// Поиск и фильтры каталога: текст, раздел, цена, размер, «Fits me», «In stock», сортировка.
import { compareSizes, filterCatalog, filtersFromParams, fitsBuyer, sizesOf } from './catalogFilter';

const BODY = { heightCm: 166, chest: 88, waist: 70, hips: 96 };
const DRESS = {
  _id: 'd', title: 'Midi Dress', price: 19900, garmentType: 'dress', description: 'Linen, fully lined',
  sizeChart: [
    { size: 'S', chest: 92, waist: 76, hips: 100, fit: 'regular', stock: 0 },
    { size: 'M', chest: 96, waist: 80, hips: 104, fit: 'regular', stock: 3 },
  ],
};
const TINY = {   // меньше фигуры во всех размерах — не садится
  _id: 't', title: 'Crop Top', price: 5900, garmentType: 'top',
  sizeChart: [{ size: 'XS', chest: 70, fit: 'tight' }],
};
const BAG = { _id: 'b', title: 'Tote Bag', price: 12900, garmentType: 'accessory', store: 'Leather Lab', sizeChart: [] };
const ALL = [DRESS, TINY, BAG];
const run = (qs, profile = BODY) => filterCatalog(ALL, filtersFromParams(new URLSearchParams(qs)), profile).map((p) => p._id);

test('search looks at the title, description, store and type; every word must match', () => {
  expect(run('q=linen')).toEqual(['d']);
  expect(run('q=leather lab')).toEqual(['b']);
  expect(run('q=dress lined')).toEqual(['d']);
  expect(run('q=dress wool')).toEqual([]);
});

test('section, price range and sort', () => {
  expect(run('type=top')).toEqual(['t']);
  expect(run('min=6000&max=15000')).toEqual(['b']);
  expect(run('sort=price-asc')).toEqual(['t', 'b', 'd']);
  expect(run('sort=price-desc')).toEqual(['d', 'b', 't']);
});

test('size filter; with "In stock" a sold-out size does not count', () => {
  expect(run('size=S')).toEqual(['d']);
  expect(run('size=S&stock=1')).toEqual([]);
  expect(run('size=M,XS')).toEqual(['d', 't']);
});

test('"Fits me": items with a size that fits the figure and is in stock; no chart — hidden', () => {
  expect(fitsBuyer(DRESS, BODY)).toBe(true);
  expect(fitsBuyer(TINY, BODY)).toBe(false);
  expect(fitsBuyer(BAG, BODY)).toBe(false);
  expect(run('fits=1')).toEqual(['d']);
  expect(run('fits=1', null)).toEqual([]);   // без обмеров ничего не «подходит»
});

test('sizes are listed in a natural order', () => {
  expect(sizesOf(ALL)).toEqual(['XS', 'S', 'M']);
  expect(['XL', '42', 'S', '38', 'XXS'].sort(compareSizes)).toEqual(['XXS', 'S', 'XL', '38', '42']);
});
