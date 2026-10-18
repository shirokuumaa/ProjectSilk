// Удалённый товар пропадает из гардеробов: при удалении, а старые «осиротевшие» записи — при чтении.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, withTestDb, PNG } from './helpers.js';

describe('удалённые товары и гардероб', () => {
  let srv, seller, alice, bob;

  const addProduct = async (title) => (await api('POST', '/api/products', {
    token: seller.token,
    files: { image: [`${title}.png`, PNG] },
    fields: { title, price: '1000', garmentType: 'top' },
  })).json;
  const save = (user, p) => api('POST', '/api/wardrobe', {
    token: user.token, body: { productId: p._id, name: p.title, image: p.image },
  });
  const wardrobe = async (user) => (await api('GET', '/api/wardrobe', { token: user.token })).json.map((x) => x.name);

  before(async () => {
    srv = await startTestServer();
    seller = await newUser('delseller', { accountType: 'seller', storeName: 'Del Shop' });
    alice = await newUser('delalice');
    bob = await newUser('delbob');
  });
  after(() => srv?.stop());

  it('продавец удалил товар — он пропал из гардеробов всех покупателей', async () => {
    const tee = await addProduct('Tee');
    const skirt = await addProduct('Skirt');
    assert.equal((await save(alice, tee)).status, 201);
    assert.equal((await save(alice, skirt)).status, 201);
    assert.equal((await save(bob, tee)).status, 201);

    assert.equal((await api('DELETE', `/api/products/${tee._id}`, { token: seller.token })).status, 200);

    assert.deepEqual(await wardrobe(alice), ['Skirt']);
    assert.deepEqual(await wardrobe(bob), []);
    const left = await withTestDb((db) => db.collection('wardrobeitems').countDocuments({ productId: tee._id }));
    assert.equal(left, 0);
  });

  it('удалённый или несуществующий товар добавить нельзя → 404', async () => {
    const gone = await addProduct('Gone');
    await api('DELETE', `/api/products/${gone._id}`, { token: seller.token });
    assert.equal((await save(alice, gone)).status, 404);
    assert.equal((await save(alice, { _id: 'not-an-id', title: 'X' })).status, 404);
  });

  it('старые записи о товарах, которых уже нет, не отдаются и стираются', async () => {
    const hat = await addProduct('Hat');
    assert.equal((await save(bob, hat)).status, 201);
    await withTestDb((db) => db.collection('wardrobeitems').insertMany([
      { user: 'delbob', productId: '64b000000000000000000000', name: 'Old dress', price: 0, image: '' },
      { user: 'delbob', productId: 'legacy-sku', name: 'Legacy', price: 0, image: '' },
    ]));

    assert.deepEqual(await wardrobe(bob), ['Hat']);
    const left = await withTestDb((db) => db.collection('wardrobeitems').countDocuments({ user: 'delbob' }));
    assert.equal(left, 1);
  });
});
