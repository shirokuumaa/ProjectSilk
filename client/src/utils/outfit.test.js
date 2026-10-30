// Образ на аватаре витрины: слоты как у полной примерки, платье ↔ верх и низ, стандартная фигура.
import { OUTFIT_KEY, STANDARD_FIGURE, figureOf, readOutfit, recommendedFor, saveOutfit, wearInSlots } from './outfit';

beforeEach(() => localStorage.clear());

test('a dress takes off the top and the bottom, and a top takes off the dress', () => {
  let s = readOutfit();
  s = wearInSlots(s, 'top', 't');
  s = wearInSlots(s, 'bottom', 'b');
  s = wearInSlots(s, 'dress', 'd');
  expect([s.top, s.bottom, s.dress]).toEqual([null, null, 'd']);
  s = wearInSlots(s, 'top', 't2');
  expect([s.top, s.dress]).toEqual(['t2', null]);
});

test('the outfit is saved in the full try-on format', () => {
  saveOutfit(wearInSlots(readOutfit(), 'dress', 'd1'));
  expect(JSON.parse(localStorage.getItem(OUTFIT_KEY)).dress).toBe('d1');
  expect(readOutfit().dress).toBe('d1');
});

test('without measurements the standard figure is used; sizes are recommended for it', () => {
  expect(figureOf(null)).toBe(STANDARD_FIGURE);
  const own = { heightCm: 170, chest: 100, waist: 84, hips: 106 };
  expect(figureOf(own)).toBe(own);
  const tee = { sizeChart: [{ size: 'S', chest: 92, fit: 'regular' }, { size: 'XL', chest: 120, fit: 'regular' }] };
  expect(recommendedFor(tee, STANDARD_FIGURE).row.size).toBe('S');
  expect(recommendedFor({ sizeChart: [] }, STANDARD_FIGURE)).toBeNull();
});
