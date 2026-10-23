// Тянущаяся ткань в подборе размера: «No stretch» / «Slight stretch» / «Stretchy».
import {
  evaluateMeasurement, evaluateSize, findBestSize, sizeChartOf, stretchShare, STRETCH_NOTES,
} from './fitCalculator';

describe('the research case: a stretch dress 7 cm smaller than the body at the waist', () => {
  const body = 69;
  const garment = 62;

  test('Stretchy: not "too tight" — a good fit, for a regular or a fitted cut', () => {
    expect(evaluateMeasurement(body, garment, 'regular', 'stretchy').level).toBe('good');
    expect(evaluateMeasurement(body, garment, 'tight', 'stretchy').level).toBe('good');
  });

  test('the same numbers without stretch, or with slight stretch, do not close', () => {
    expect(evaluateMeasurement(body, garment, 'regular', 'none').level).toBe('too_tight');
    expect(evaluateMeasurement(body, garment, 'regular', 'slight').level).toBe('too_tight');
  });
});

describe('Zara stretch maxi dress (flat × 2): S is 73 / 62 / 80 cm', () => {
  const chart = [
    { size: 'XS', chest: 71, waist: 59, hips: 78 },
    { size: 'S', chest: 73, waist: 62, hips: 80 },
    { size: 'M', chest: 75, waist: 65, hips: 82 },
    { size: 'L', chest: 77, waist: 68, hips: 84 },
  ];
  const product = { stretch: 'stretchy', sizeChart: chart.map((r) => ({ ...r, fit: 'tight' })) };
  const S = { chest: 86, waist: 66, hips: 94 };

  test('an S figure gets a wearable size, not "No size will really work"; S itself is a good fit', () => {
    const r = findBestSize(S, sizeChartOf(product));
    expect(r.recommended.wearable).toBe(true);
    // облегающий крой и подходят несколько размеров — советуем меньший: S (так платье и продаётся)
    expect(r.recommended.size).toBe('S');
    expect(r.message).toBe('Your size is S — a fitted cut sits best in the smaller size');
    expect(r.all.find((x) => x.size === 'S').level).toBe('good');
  });

  test('a smaller figure is sent to a smaller size', () => {
    const r = findBestSize({ chest: 82, waist: 62, hips: 90 }, sizeChartOf(product));
    expect(r.recommended.size).toBe('XS');
  });

  test('without stretch the same chart is far too small', () => {
    const r = findBestSize(S, sizeChartOf({ ...product, stretch: 'none' }));
    expect(r.recommended.wearable).toBe(false);
  });

  test('a much larger figure is still told it will not close', () => {
    const r = findBestSize({ chest: 110, waist: 94, hips: 118 }, sizeChartOf(product));
    expect(r.recommended.wearable).toBe(false);
  });
});

describe('stretch rules', () => {
  test('allowances: none 0 %, slight 5 %, stretchy 15 % of the body girth', () => {
    expect(stretchShare('none')).toBe(0);
    expect(stretchShare('slight')).toBe(0.05);
    expect(stretchShare('stretchy')).toBe(0.15);
  });

  test('old products: no level and the old numeric "Stretch, %" both count as no stretch', () => {
    expect(sizeChartOf({ sizeChart: [{ size: 'S', waist: 62, stretch: 15 }] })[0].stretch).toBe('none');
    expect(stretchShare(15)).toBe(0);
    expect(evaluateMeasurement(69, 62, 'regular', 15).level).toBe('too_tight');
  });

  test('stretch does not make a loose garment looser', () => {
    const plain = evaluateMeasurement(90, 110, 'regular', 'none');
    const knit = evaluateMeasurement(90, 110, 'regular', 'stretchy');
    expect(knit.level).toBe(plain.level);
  });

  test('a stretchy garment a little bigger than the body still fits well', () => {
    expect(evaluateMeasurement(90, 92, 'regular', 'stretchy').level).toBe('good');
  });

  test('sizeChartOf puts the product level on every row and keeps the girths', () => {
    const rows = sizeChartOf({ stretch: 'slight', sizeChart: [{ size: 'S', chest: 90 }, { size: 'M', chest: 96 }] });
    expect(rows).toEqual([{ size: 'S', chest: 90, stretch: 'slight' }, { size: 'M', chest: 96, stretch: 'slight' }]);
  });

  test('evaluateSize reads the level from the row', () => {
    const row = { size: 'S', waist: 62, stretch: 'stretchy' };
    expect(evaluateSize({ waist: 69 }, row).wearable).toBe(true);
  });

  test('buyer notes exist for both stretch levels', () => {
    expect(STRETCH_NOTES.stretchy).toBe('Stretchy fabric — fits snugly');
    expect(STRETCH_NOTES.slight).toMatch(/^Slight stretch/);
  });
});

describe('fitted cut between two sizes', () => {
  // ease для облегающего кроя: хорошо от −2 до +6 см. Фигура между S (−1 см) и M (+4 см):
  // оба размера садятся хорошо, по близости к «идеалу» (+2) ближе M.
  const body = { chest: 90, waist: 72, hips: 98 };
  const chart = (fit) => [
    { size: 'M', chest: 94, waist: 76, hips: 102, fit },
    { size: 'S', chest: 89, waist: 71, hips: 97, fit },
    { size: 'L', chest: 100, waist: 82, hips: 108, fit },
  ];

  test('both S and M fit a fitted dress — the smaller one is advised', () => {
    const r = findBestSize(body, chart('tight'));
    expect(r.all.filter((s) => s.text === 'good fit').map((s) => s.size).sort()).toEqual(['M', 'S']);
    expect(r.recommended.size).toBe('S');
    expect(r.message).toBe('Your size is S — a fitted cut sits best in the smaller size');
  });

  test('a regular cut keeps the size closest to its ideal ease', () => {
    const r = findBestSize(body, chart('regular'));
    expect(r.recommended.size).not.toBe('S');
    expect(r.message).toBe(`Your size is ${r.recommended.size}`);
  });

  test('a fitted cut with only one good size is unchanged', () => {
    const r = findBestSize({ chest: 86, waist: 68, hips: 94 }, chart('tight'));
    expect(r.all.filter((s) => s.text === 'good fit').map((s) => s.size)).toEqual(['S']);
    expect(r.recommended.size).toBe('S');
    expect(r.message).toBe('Your size is S');
  });

  test('choosing the larger of the two explains that the smaller fits better', () => {
    const r = findBestSize(body, chart('tight'), 'M');
    expect(r.recommended.size).toBe('S');
    expect(r.chosen.size).toBe('M');
  });
});
