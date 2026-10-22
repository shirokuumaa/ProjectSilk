// Тянучесть ткани у товара: none / slight / stretchy; у старых товаров — none.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, withTestDb, PNG } from './helpers.js';

describe('товар: тянется ли ткань', () => {
  let srv, seller;

  const create = (fields) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['dress.png', PNG] },
    fields: { title: 'Dress', price: '19900', garmentType: 'dress', ...fields },
  });

  before(async () => {
    srv = await startTestServer();
    seller = await newUser('stretchseller', { accountType: 'seller', storeName: 'Stretch Shop' });
  });
  after(() => srv?.stop());

  it('сохраняет выбор продавца', async () => {
    const r = await create({ stretch: 'stretchy' });
    assert.equal(r.status, 201);
    assert.equal(r.json.stretch, 'stretchy');
    assert.equal((await api('GET', `/api/products/${r.json._id}`)).json.stretch, 'stretchy');
  });

  it('без выбора — «No stretch»', async () => {
    const r = await create({});
    assert.equal(r.json.stretch, 'none');
  });

  it('неизвестное значение → 400 с понятным сообщением', async () => {
    const r = await create({ stretch: 'very' });
    assert.equal(r.status, 400);
    assert.match(r.json.details.join(' '), /Fabric stretch must be none, slight or stretchy/);
  });

  it('PATCH меняет тянучесть', async () => {
    const p = (await create({ stretch: 'none' })).json;
    const r = await api('PATCH', `/api/products/${p._id}`, { token: seller.token, fields: { stretch: 'slight' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.stretch, 'slight');
  });

  it('старый товар без поля отдаётся как «No stretch» — в списке, в «моих» и по id', async () => {
    const p = (await create({})).json;
    await withTestDb((db) => db.collection('products').updateOne(
      { title: 'Dress', stretch: 'none' }, { $unset: { stretch: '' } },
    ));
    const all = (await api('GET', '/api/products')).json;
    assert.ok(all.every((x) => ['none', 'slight', 'stretchy'].includes(x.stretch)));
    const mine = (await api('GET', '/api/products/mine', { token: seller.token })).json;
    assert.ok(mine.every((x) => x.stretch));
    assert.ok((await api('GET', `/api/products/${p._id}`)).json.stretch);
  });
});
