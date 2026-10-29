// Подсказка тянучести по составу ткани: эластан 3–7 % — Slight stretch, от 8 % — Stretchy.
import { stretchFromComposition } from '../components/ProductDetailsField';

test.each([
  [[{ fibre: 'Cotton', percent: 100 }], null],
  [[{ fibre: 'Cotton', percent: 98 }, { fibre: 'Elastane', percent: 2 }], null],
  [[{ fibre: 'Cotton', percent: 97 }, { fibre: 'Elastane', percent: 3 }], 'slight'],
  [[{ fibre: 'Polyester', percent: 92 }, { fibre: 'Elastane', percent: 8 }], 'stretchy'],
  [[{ fibre: 'Nylon', percent: 80 }, { fibre: 'Spandex', percent: 20 }], 'stretchy'],
  [[{ fibre: 'Viscose', percent: 95 }, { fibre: 'LYCRA®', percent: 5 }], 'slight'],
])('%j → %s', (rows, stretch) => {
  expect(stretchFromComposition(rows)?.stretch ?? null).toBe(stretch);
});
