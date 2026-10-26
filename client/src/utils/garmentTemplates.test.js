// Шаблон для вещи без 3D-модели: по типу вещи, а для низа — по штанинам или названию.
import { garmentTypeOf, offFigureReason, templateFor } from './garmentTemplates';

test.each([
  [{ garmentType: 'top', name: 'Cotton Tee' }, 'tee'],
  [{ garmentType: 'top', name: 'Ribbed crop top' }, 'croptop'],
  [{ garmentType: 'top', name: 'Silk blouse' }, 'blouse'],
  [{ garmentType: 'top', name: 'Basic T-shirt' }, 'tee'],
  [{ garmentType: 'bottom', name: 'Straight Jeans', legs: 'split' }, 'jeans'],
  [{ garmentType: 'bottom', name: 'Pleated Skirt' }, 'skirt'],
  [{ garmentType: 'bottom', name: 'Midi', legs: 'joined' }, 'skirt'],
  [{ garmentType: 'bottom', name: 'Denim shorts' }, 'shorts'],
  [{ garmentType: 'bottom', name: 'Yoga leggings' }, 'leggings'],
  [{ garmentType: 'dress', name: 'Wrap Dress' }, 'dress'],
])('%o → %s', (item, id) => {
  const t = templateFor(item);
  expect(t.id).toBe(id);
  expect(t.url).toBe(id === 'dress' ? '/uploads/stub/dress.glb' : `/models/test-garments/${id}.glb`);
});

test('legs follow the template geometry: trousers split, skirts and dresses joined', () => {
  expect(templateFor({ garmentType: 'bottom', name: 'Jeans' }).legs).toBe('split');
  expect(templateFor({ garmentType: 'bottom', name: 'Skirt' }).legs).toBe('joined');
  expect(templateFor({ garmentType: 'dress', name: 'Dress' }).legs).toBe('joined');
});

test('no template for outerwear, shoes and accessories', () => {
  ['outerwear', 'shoes', 'accessory'].forEach((garmentType) => {
    expect(templateFor({ garmentType, name: 'Item' })).toBeNull();
  });
});

test('an item with its own 3D model does not need a template', () => {
  expect(templateFor({ garmentType: 'top', name: 'Tee', model3d: '/uploads/models/tee.glb' })).toBeNull();
});

test('every template file exists in public/', () => {
  const fs = require('fs');
  const path = require('path');
  const ids = ['tee', 'croptop', 'blouse', 'jeans', 'shorts', 'leggings', 'skirt', 'dress'];
  const types = { tee: 'top', croptop: 'top', blouse: 'top', jeans: 'bottom', shorts: 'bottom', leggings: 'bottom', skirt: 'bottom', dress: 'dress' };
  const names = { croptop: 'crop', blouse: 'blouse', shorts: 'shorts', leggings: 'leggings', skirt: 'skirt' };
  ids.forEach((id) => {
    const t = templateFor({ garmentType: types[id], name: names[id] || id });
    expect(t.id).toBe(id);
    expect(fs.existsSync(path.join(__dirname, '../../public', t.url))).toBe(true);
  });
});

describe('an item without a garment type', () => {
  test.each([
    [{ garmentType: 'dress', category: 'Clothes' }, 'dress'],
    [{ garmentType: 'shoes' }, 'shoes'],
    [{ category: 'Ankle boots' }, 'shoes'],          // явное слово в категории
    [{ category: 'Dresses' }, 'dress'],
    [{ category: 'Clothes' }, null],                  // раньше — «верх» по умолчанию
    [{ category: 'Electronics' }, null],
    [{ garmentType: 'hat', category: 'Clothes' }, null],
    [{}, null],
  ])('%o → %s', (item, type) => {
    expect(garmentTypeOf(item)).toBe(type);
  });

  test('is not worn as a generic tee and is explained as "type not set"', () => {
    const item = { name: 'Test dress', category: 'Clothes' };
    expect(templateFor(item)).toBeNull();
    expect(offFigureReason(item)).toMatch(/^Test dress: type not set\./);
  });

  test('an item with a type has no off-figure reason', () => {
    expect(offFigureReason({ name: 'Tee', garmentType: 'top' })).toBeNull();
  });
});

describe('items with no generic shape (coats, shoes, accessories)', () => {
  test.each([
    ['outerwear', 'Wool Coat', 'coats and jackets'],
    ['shoes', 'Leather Sneakers', 'shoes'],
    ['accessory', 'Silk Scarf', 'accessories'],
  ])('%s without a 3D model is explained, not invisible', (garmentType, name, noun) => {
    expect(offFigureReason({ garmentType, name })).toBe(
      `${name} has no 3D model yet, and there is no generic shape for ${noun}, so it is not shown on the figure.`,
    );
  });

  test('with a size chart the buyer is told the size advice still works', () => {
    const coat = { garmentType: 'outerwear', name: 'Wool Coat', sizeChart: [{ size: 'M', chest: 100 }] };
    expect(offFigureReason(coat)).toMatch(/The size advice still works/);
  });

  test('with its own 3D model or drapes by size it is worn', () => {
    expect(offFigureReason({ garmentType: 'shoes', name: 'Boots', model3d: '/uploads/models/boots.glb' })).toBeNull();
    expect(offFigureReason({ garmentType: 'outerwear', name: 'Coat', sizeModels: [{ size: 'M', model3d: '/m.glb' }] })).toBeNull();
  });
});
