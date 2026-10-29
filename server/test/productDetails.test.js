// Карточка товара: галерея фото, описание, состав ткани, уход, страна, остаток по размерам.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestServer, api, newUser, PNG } from './helpers.js';
import { parseComposition, nextGallery, normalizeStock } from '../utils/productDetails.js';

const CHART = [{ size: 'S', chest: 86, stock: 3 }, { size: 'M', chest: 90, stock: 0 }, { size: 'L', chest: 94, stock: '' }];

describe('product details', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('detailseller', { accountType: 'seller', storeName: 'Detail Shop' });
  });
  after(() => srv?.stop());

  const create = (fields = {}, gallery = []) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['main.png', PNG], ...(gallery.length ? { gallery } : {}) },
    fields: { title: 'Dress', price: '19900', garmentType: 'dress', ...fields },
  });
  const patch = (id, fields = {}, gallery = []) => api('PATCH', `/api/products/${id}`, {
    token: seller.token, files: gallery.length ? { gallery } : {}, fields,
  });

  it('description, composition, care, country and stock per size are saved and shown to buyers', async () => {
    const r = await create({
      description: '  A light summer dress.\r\nFully lined.  ',
      composition: JSON.stringify([{ fibre: 'Polyester', percent: 92 }, { fibre: 'Elastane', percent: 8 }]),
      care: 'Machine wash at 30 °C',
      countryOfOrigin: 'Kazakhstan',
      sizeChart: JSON.stringify(CHART),
    });
    assert.equal(r.status, 201, r.text);
    const got = (await api('GET', `/api/products/${r.json._id}`)).json;
    assert.equal(got.description, 'A light summer dress.\nFully lined.');
    assert.deepEqual(got.composition, [{ fibre: 'Polyester', percent: 92 }, { fibre: 'Elastane', percent: 8 }]);
    assert.equal(got.care, 'Machine wash at 30 °C');
    assert.equal(got.countryOfOrigin, 'Kazakhstan');
    assert.deepEqual(got.sizeChart.map((s) => s.stock), [3, 0, undefined]);   // пусто — не указан
  });

  it('several photos make the gallery; their files go with the product', async () => {
    const r = await create({}, [['back.png', PNG], ['detail.png', PNG]]);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.images.length, 2);
    assert.match(r.json.images[0], /^\/uploads\/images\/.+back\.png$/);
    const paths = r.json.images.map((u) => srv.diskPath(u));
    paths.forEach((p) => assert.ok(fs.existsSync(p)));

    await api('DELETE', `/api/products/${r.json._id}`, { token: seller.token });
    paths.forEach((p) => assert.ok(!fs.existsSync(p)));
  });

  it('editing: photos can be reordered, removed and added; a removed file is deleted', async () => {
    const made = (await create({}, [['a.png', PNG], ['b.png', PNG]])).json;
    const [a, b] = made.images;
    const r = await patch(made._id, { galleryKeep: JSON.stringify([b, '/uploads/images/someone_else.png']) }, [['c.png', PNG]]);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.images.length, 2);
    assert.equal(r.json.images[0], b);
    assert.match(r.json.images[1], /c\.png$/);
    assert.ok(!fs.existsSync(srv.diskPath(a)));
  });

  it('a change without the photo list keeps the gallery; text fields can be cleared', async () => {
    const made = (await create({ care: 'Hand wash' }, [['a.png', PNG]])).json;
    const r = await patch(made._id, { title: 'Dress 2', care: '' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.images, made.images);
    assert.equal(r.json.care, undefined);
  });

  it('bad input → 400 with a message for the seller, nothing left on disk', async () => {
    const files = srv.countFiles();
    const cases = [
      [{ composition: JSON.stringify([{ fibre: 'Cotton', percent: 60 }]) }, 'Fabric composition must add up to 100 % (now 60 %).'],
      [{ composition: JSON.stringify([{ fibre: '', percent: 100 }]) }, 'Each fibre needs a name (up to 40 characters).'],
      [{ composition: 'nope' }, 'Fabric composition could not be read.'],
      [{ sizeChart: JSON.stringify([{ size: 'S', chest: 86, stock: -1 }]) }, 'Stock for size S must be a whole number, 0 or more.'],
      [{ sizeChart: JSON.stringify([{ size: 'S', chest: 86, stock: 1.5 }]) }, 'Stock for size S must be a whole number, 0 or more.'],
      [{ description: 'x'.repeat(4001) }, 'Description is too long (maximum 4000 characters).'],
    ];
    for (const [fields, message] of cases) {
      const r = await create(fields, [['g.png', PNG]]);
      assert.equal(r.status, 400, JSON.stringify(fields).slice(0, 80));
      assert.equal(r.json.message, message);
    }
    const tooMany = await create({}, Array.from({ length: 9 }, (_, i) => [`g${i}.png`, PNG]));
    assert.equal(tooMany.status, 400);
    assert.equal(srv.countFiles(), files);
  });

  it('a gallery file that is not a picture → 400', async () => {
    const r = await create({}, [['g.png', Buffer.from('not an image')]]);
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Gallery photo must be a JPEG, PNG or WebP file.');
  });
});

describe('product details helpers', () => {
  it('composition: empty clears it; ±0.5 % rounding on the label is accepted', () => {
    assert.deepEqual(parseComposition(''), { composition: undefined });
    assert.deepEqual(parseComposition(undefined), { skip: true });
    assert.equal(parseComposition(JSON.stringify([{ fibre: 'Cotton', percent: 66.7 }, { fibre: 'Linen', percent: 33.7 }])).error, undefined);
  });

  it('stock: empty is dropped, numbers become whole numbers', () => {
    const rows = [{ size: 'S', stock: '4' }, { size: 'M', stock: '' }];
    assert.equal(normalizeStock(rows), null);
    assert.deepEqual(rows, [{ size: 'S', stock: 4 }, { size: 'M' }]);
  });

  it('gallery: only own photos can be kept, at most 8', () => {
    assert.deepEqual(nextGallery(['/a'], JSON.stringify(['/x', '/a', '/a']), []), { images: ['/a'], removed: [] });
    assert.equal(nextGallery([], undefined, Array(9).fill('/n')).error, 'Up to 8 extra photos.');
  });
});

describe('store name on products', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('storeseller', { accountType: 'seller', storeName: 'Linen & Co' });
  });
  after(() => srv?.stop());

  it('the catalogue and the product page say which store sells the item', async () => {
    const made = (await api('POST', '/api/products', {
      token: seller.token, files: { image: ['m.png', PNG] },
      fields: { title: 'Shirt', price: '9900', garmentType: 'top' },
    })).json;
    const list = (await api('GET', '/api/products')).json;
    assert.equal(list.find((p) => p._id === made._id).store, 'Linen & Co');
    assert.equal((await api('GET', `/api/products/${made._id}`)).json.store, 'Linen & Co');
  });
});
