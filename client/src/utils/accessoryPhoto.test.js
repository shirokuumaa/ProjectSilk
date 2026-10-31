// Проверка фото аксессуара: чистое фото — без предупреждений; пёстрый фон, мелкая или обрезанная вещь,
// кожа, лишние предметы — каждое со своим предупреждением; пара серёг или обуви — не лишний предмет.
import { checkAccessoryPhoto, isSkin } from './accessoryPhoto';

const W = 64;
const H = 64;

/** Фото W × H: фон bg, прямоугольники [x0, y0, x1, y1, rgb]. */
function photo(bg, rects = [], noise = 0) {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = bg.map((v) => v + (noise ? (rnd() - 0.5) * noise : 0));
      rects.forEach(([x0, y0, x1, y1, rgb]) => { if (x >= x0 && x < x1 && y >= y0 && y < y1) c = rgb; });
      data.set([...c, 255], i);
    }
  }
  return data;
}

const WHITE = [245, 245, 245];
const BLACK = [30, 30, 30];
const SKIN = [224, 172, 140];

test('one item on a plain background — no warnings', () => {
  expect(checkAccessoryPhoto(photo(WHITE, [[16, 16, 48, 48, BLACK]]), W, H, { kind: 'watch' })).toEqual([]);
});

test('a busy background', () => {
  const w = checkAccessoryPhoto(photo([128, 128, 128], [[16, 16, 48, 48, BLACK]], 240), W, H, { kind: 'watch' });
  expect(w).toEqual(['The background is busy. Shoot the item on a plain, single-colour background.']);
});

test('a tiny item, an item filling the photo, an item cut by the edge', () => {
  expect(checkAccessoryPhoto(photo(WHITE, [[30, 30, 34, 34, BLACK]]), W, H)).toContain(
    'The item is very small in the photo. Let it fill most of the frame.');
  expect(checkAccessoryPhoto(photo(WHITE, [[1, 1, 63, 63, BLACK]]), W, H)).toContain(
    'The item fills the whole photo. Leave some plain background around it.');
  expect(checkAccessoryPhoto(photo(WHITE, [[0, 10, 64, 40, BLACK]]), W, H)).toContain(
    'The item touches the edge of the photo. Keep the whole item in the frame.');
});

test('hands or a person in the photo', () => {
  const w = checkAccessoryPhoto(photo(WHITE, [[10, 10, 54, 54, SKIN], [26, 26, 38, 38, BLACK]]), W, H, { kind: 'ring' });
  expect(w).toContain('There seem to be hands, skin or a person in the photo. Photograph the item on its own.');
  expect(isSkin(...SKIN)).toBe(true);
  expect(isSkin(...BLACK)).toBe(false);
  expect(isSkin(200, 160, 60)).toBe(false);   // золото часов
  expect(isSkin(120, 30, 40)).toBe(false);    // бордовая кожа туфель
  expect(isSkin(165, 103, 98)).toBe(false);   // она же на свету
  expect(isSkin(146, 120, 76)).toBe(false);   // золото в тени
  expect(isSkin(141, 85, 36)).toBe(true);     // тёмная кожа
  expect(isSkin(250, 215, 190)).toBe(true);   // светлая кожа
});

test('several items; a pair is fine for earrings and shoes', () => {
  const two = photo(WHITE, [[8, 20, 26, 44, BLACK], [38, 20, 56, 44, BLACK]]);
  const three = photo(WHITE, [[4, 20, 18, 44, BLACK], [25, 20, 39, 44, BLACK], [46, 20, 60, 44, BLACK]]);
  expect(checkAccessoryPhoto(two, W, H, { kind: 'earrings' })).toEqual([]);
  expect(checkAccessoryPhoto(two, W, H, { kind: 'shoes' })).toEqual([]);
  expect(checkAccessoryPhoto(two, W, H, { kind: 'handbag' })).toEqual(['There seem to be several items. Show one item on its own.']);
  expect(checkAccessoryPhoto(three, W, H, { kind: 'earrings' })).toEqual(['There seem to be more than two items. Show one item or one pair.']);
});
