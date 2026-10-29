// Строки корзины: товар + размер; размер — выбранный, иначе рекомендованный по обмерам.
import { addCartLines, cartLineKey, cartSizeFor, removeCartLine } from './cart';

const TEE = {
  _id: 'tee', title: 'Basic Tee', garmentType: 'top',
  sizeChart: [
    { size: 'S', chest: 92, waist: 84, fit: 'regular' },
    { size: 'M', chest: 96, waist: 88, fit: 'regular' },
  ],
};

beforeEach(() => localStorage.clear());

describe('cartSizeFor', () => {
  test('the size the buyer picked wins', () => {
    expect(cartSizeFor(TEE, 'M')).toBe('M');
  });

  test('otherwise the size recommended for the cached measurements', () => {
    localStorage.setItem('bodyProfile', JSON.stringify({ heightCm: 166, chest: 90, waist: 70, hips: 96 }));
    expect(cartSizeFor(TEE)).toBe('S');
  });

  test('no measurements or no size chart — no size', () => {
    expect(cartSizeFor(TEE)).toBeNull();
    localStorage.setItem('bodyProfile', JSON.stringify({ heightCm: 166, chest: 90, waist: 70, hips: 96 }));
    expect(cartSizeFor({ _id: 'bag', sizeChart: [] })).toBeNull();
  });
});

describe('cart lines', () => {
  test('the same item in two sizes is two lines; the same size adds to the quantity', () => {
    let lines = addCartLines([], { id: 'tee', name: 'Basic Tee', size: 'S' });
    lines = addCartLines(lines, { id: 'tee', name: 'Basic Tee', size: 'M' });
    lines = addCartLines(lines, { id: 'tee', name: 'Basic Tee', size: 'S' });
    expect(lines.map((x) => [x.size, x.quantity])).toEqual([['S', 2], ['M', 1]]);
  });

  test('several items at once (a whole look), an item without a size keeps size null', () => {
    const lines = addCartLines([], [{ id: 'tee', size: 'S' }, { id: 'bag' }]);
    expect(lines.map(cartLineKey)).toEqual(['tee|S', 'bag|']);
    expect(lines[1].size).toBeNull();
  });

  test('removing takes one piece from that size only; the last piece removes the line', () => {
    const lines = [
      { id: 'tee', size: 'S', quantity: 2 },
      { id: 'tee', size: 'M', quantity: 1 },
    ];
    expect(removeCartLine(lines, 'tee|S')).toEqual([
      { id: 'tee', size: 'S', quantity: 1 },
      { id: 'tee', size: 'M', quantity: 1 },
    ]);
    expect(removeCartLine(lines, 'tee|M')).toEqual([{ id: 'tee', size: 'S', quantity: 2 }]);
  });

  test('old lines saved without a size still match their key', () => {
    expect(removeCartLine([{ id: 'p1', quantity: 1 }], 'p1|')).toEqual([]);
  });
});
