// Основной цвет товара: сохраняется как #rrggbb, неверный — 400, пустой — снимается.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, PNG } from './helpers.js';

describe('product colour', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('colorseller', { accountType: 'seller', storeName: 'Colour Shop' });
  });
  after(() => srv?.stop());

  const create = (color) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['tee.png', PNG] },
    fields: { title: 'Tee', price: '9900', garmentType: 'top', ...(color === undefined ? {} : { color }) },
  });

  it('is saved in lower case and shown in the catalogue', async () => {
    const r = await create('#C81E28');
    assert.equal(r.status, 201);
    assert.equal(r.json.color, '#c81e28');
    const list = (await api('GET', '/api/products')).json;
    assert.equal(list.find((p) => p._id === r.json._id).color, '#c81e28');
  });

  it('no colour or an empty one — none', async () => {
    assert.equal((await create()).json.color, undefined);
    assert.equal((await create('')).json.color, undefined);
  });

  it('anything but #rrggbb → 400', async () => {
    for (const bad of ['red', '#fff', 'url(x)', '#12345g']) {
      const r = await create(bad);
      assert.equal(r.status, 400, bad);
      assert.match(r.json.message, /Colour must look like/);
    }
  });

  it('can be changed and cleared', async () => {
    const id = (await create('#c81e28')).json._id;
    const set = await api('PATCH', `/api/products/${id}`, { token: seller.token, body: { color: '#1a2b3c' } });
    assert.equal(set.json.color, '#1a2b3c');
    const cleared = await api('PATCH', `/api/products/${id}`, { token: seller.token, body: { color: '' } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.color, undefined);
  });
});
