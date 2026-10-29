// Принт ткани: плитка с фото и повтор в см; без плитки — однотонная вещь; повтор вне 1…200 см — 400;
// плитку можно заменить и снять, её файл удаляется вместе с товаром.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestServer, api, newUser, PNG } from './helpers.js';

describe('fabric print', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('printseller', { accountType: 'seller', storeName: 'Print Shop' });
  });
  after(() => srv?.stop());

  const create = (fields = {}, print = true) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['dress.png', PNG], ...(print ? { print: ['tile.png', PNG] } : {}) },
    fields: { title: 'Dress', price: '19900', garmentType: 'dress', ...fields },
  });
  const patch = (id, { fields, print } = {}) => api('PATCH', `/api/products/${id}`, {
    token: seller.token,
    files: print ? { print: ['tile2.png', PNG] } : {},
    fields: fields || {},
  });

  it('a tile with its repeat is saved and shown in the catalogue', async () => {
    const r = await create({ printTileCm: '6.5' });
    assert.equal(r.status, 201);
    assert.match(r.json.print.image, /^\/uploads\/images\/.+tile\.png$/);
    assert.equal(r.json.print.tileCm, 6.5);
    const list = (await api('GET', '/api/products')).json;
    assert.deepEqual(list.find((p) => p._id === r.json._id).print, r.json.print);
  });

  it('no repeat given — 10 cm; no tile — a plain item', async () => {
    assert.equal((await create()).json.print.tileCm, 10);
    assert.equal((await create({ printTileCm: '8' }, false)).json.print, undefined);
  });

  it('a repeat outside 1…200 cm → 400, nothing left on disk', async () => {
    const files = srv.countFiles();
    for (const bad of ['0', '250', 'big']) {
      const r = await create({ printTileCm: bad });
      assert.equal(r.status, 400, bad);
      assert.equal(r.json.message, 'Print repeat must be between 1 and 200 cm.');
    }
    assert.equal(srv.countFiles(), files);
  });

  it('a print image that is not a picture → 400', async () => {
    const r = await api('POST', '/api/products', {
      token: seller.token,
      files: { image: ['dress.png', PNG], print: ['tile.png', Buffer.from('not an image at all')] },
      fields: { title: 'Dress', price: '19900', garmentType: 'dress' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Print image must be a JPEG, PNG or WebP file.');
  });

  it('the repeat can be changed, the tile replaced and removed; old tiles are deleted', async () => {
    const made = (await create({ printTileCm: '10' })).json;
    const first = srv.diskPath(made.print.image);
    assert.ok(fs.existsSync(first));

    const rescaled = await patch(made._id, { fields: { printTileCm: '4' } });
    assert.equal(rescaled.status, 200);
    assert.deepEqual(rescaled.json.print, { image: made.print.image, tileCm: 4 });

    const replaced = await patch(made._id, { print: true });
    assert.equal(replaced.json.print.tileCm, 4);                 // повтор прежний
    assert.notEqual(replaced.json.print.image, made.print.image);
    assert.ok(!fs.existsSync(first));
    const second = srv.diskPath(replaced.json.print.image);

    const removed = await patch(made._id, { fields: { printTileCm: '' } });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.print, undefined);
    assert.ok(!fs.existsSync(second));
  });

  it('a repeat without any tile → 400', async () => {
    const plain = (await create({}, false)).json;
    const r = await patch(plain._id, { fields: { printTileCm: '5' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Add a print image first.');
  });

  it('the tile file goes away with the product', async () => {
    const made = (await create()).json;
    const file = srv.diskPath(made.print.image);
    assert.equal((await api('DELETE', `/api/products/${made._id}`, { token: seller.token })).status, 200);
    assert.ok(!fs.existsSync(file));
  });
});
