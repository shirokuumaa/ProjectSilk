// Заказы без оплаты: оформление по каталогу, деление по продавцам, остаток размера списывается
// и возвращается при отмене, статусы ведёт продавец, чужие заказы не видны.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, PNG } from './helpers.js';

const CONTACT = { name: 'Aigerim S', phone: '+7 701 123 45 67', email: 'a@example.com' };
const ADDRESS = { country: 'kz', city: 'Almaty', line1: 'Abay Ave 10, apt 5', postcode: '050000' };
const CHART = [{ size: 'S', chest: 86, stock: 2 }, { size: 'M', chest: 90, stock: 0 }, { size: 'L', chest: 94 }];

describe('orders', () => {
  let srv, sellerA, sellerB, buyer, other, dress, tee;

  before(async () => {
    srv = await startTestServer();
    sellerA = await newUser('ordersellera', { accountType: 'seller', storeName: 'Store A' });
    sellerB = await newUser('orderssellerb', { accountType: 'seller', storeName: 'Store B' });
    buyer = await newUser('orderbuyer');
    other = await newUser('otherbuyer');
    const make = (seller, title, fields = {}) => api('POST', '/api/products', {
      token: seller.token, files: { image: ['p.png', PNG] },
      fields: { title, price: '10000', garmentType: 'dress', sizeChart: JSON.stringify(CHART), ...fields },
    }).then((r) => r.json);
    dress = await make(sellerA, 'Dress');
    tee = await make(sellerB, 'Tee', { price: '5000', garmentType: 'top' });
  });
  after(() => srv?.stop());

  const order = (token, items, extra = {}) => api('POST', '/api/orders', {
    token, body: { items, contact: CONTACT, address: ADDRESS, ...extra },
  });
  const stockOf = async (id, size) => (await api('GET', `/api/products/${id}`)).json.sizeChart.find((r) => r.size === size).stock;

  it('a cart with two sellers becomes two orders; prices come from the catalogue; stock goes down', async () => {
    const r = await order(buyer.token, [
      { productId: dress._id, size: 'S', quantity: 1, price: 1 },   // цену из корзины не берём
      { productId: tee._id, size: 'L', quantity: 2 },
    ]);
    assert.equal(r.status, 201, r.text);
    const [a, b] = r.json.orders;
    assert.equal(r.json.orders.length, 2);
    assert.match(a.number, /^PS-\d{6}-[0-9A-F]{6}$/);
    assert.equal(a.storeName, 'Store A');
    assert.equal(a.total, 10000);
    assert.equal(b.total, 10000);   // 2 × 5000
    assert.equal(a.currency, 'KZT');
    assert.equal(a.status, 'placed');
    assert.equal(a.payment.status, 'not_started');
    assert.equal(a.address.country, 'KZ');
    assert.equal(await stockOf(dress._id, 'S'), 1);
    assert.equal(await stockOf(tee._id, 'L'), undefined);   // остаток не ведётся — без изменений
  });

  it('a sold-out size or too many pieces → 409, nothing is taken', async () => {
    const sold = await order(buyer.token, [{ productId: dress._id, size: 'M', quantity: 1 }]);
    assert.equal(sold.status, 409);
    assert.equal(sold.json.message, 'Dress in size M is sold out.');
    const many = await order(buyer.token, [{ productId: tee._id, size: 'S', quantity: 1 }, { productId: dress._id, size: 'S', quantity: 5 }]);
    assert.equal(many.status, 409);
    assert.equal(many.json.message, 'Only 1 left of Dress in size S.');
    assert.equal(await stockOf(tee._id, 'S'), 2);   // футболку из той же корзины вернули
  });

  it('checkout form errors are listed together; a size is required for sized items', async () => {
    const r = await api('POST', '/api/orders', { token: buyer.token, body: { items: [{ productId: dress._id, size: 'S', quantity: 1 }], contact: {}, address: {} } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.errors, ['Please enter your name.', 'Please enter a phone number.', 'Please choose a country.', 'Please enter a city.', 'Please enter a street address.']);
    const noSize = await order(buyer.token, [{ productId: dress._id, quantity: 1 }]);
    assert.equal(noSize.json.message, 'Please choose a size for Dress.');
    assert.equal((await order(buyer.token, [])).json.message, 'Your cart is empty.');
    assert.equal((await api('POST', '/api/orders', { body: {} })).status, 401);
  });

  it('the buyer sees own orders; others and strangers do not', async () => {
    const mine = (await api('GET', '/api/orders/mine', { token: buyer.token })).json;
    assert.equal(mine.length, 2);
    assert.deepEqual((await api('GET', '/api/orders/mine', { token: other.token })).json, []);
    assert.equal((await api('GET', `/api/orders/${mine[0]._id}`, { token: other.token })).status, 404);
    assert.equal((await api('GET', `/api/orders/${mine[0]._id}`, { token: buyer.token })).status, 200);
  });

  it('the seller sees only orders of own products and moves them on; illegal moves → 409', async () => {
    const selling = (await api('GET', '/api/orders/selling', { token: sellerA.token })).json;
    assert.equal(selling.length, 1);
    assert.equal(selling[0].contact.phone, CONTACT.phone);
    const id = selling[0]._id;
    const patch = (status, token = sellerA.token) => api('PATCH', `/api/orders/${id}/status`, { token, body: { status } });
    assert.equal((await patch('delivered')).status, 409);
    assert.equal((await patch('confirmed', sellerB.token)).status, 404);
    assert.equal((await patch('confirmed')).json.status, 'confirmed');
    assert.equal((await patch('shipped')).json.status, 'shipped');
    const done = (await patch('delivered')).json;
    assert.deepEqual(done.history.map((h) => h.status), ['placed', 'confirmed', 'shipped', 'delivered']);
    assert.equal((await api('GET', '/api/orders/selling', { token: buyer.token })).status, 403);
  });

  it('cancelling returns the stock; the buyer can cancel only before the seller confirms', async () => {
    const placed = (await order(buyer.token, [{ productId: dress._id, size: 'S', quantity: 1 }])).json.orders[0];
    assert.equal(await stockOf(dress._id, 'S'), 0);
    const cancelled = await api('POST', `/api/orders/${placed._id}/cancel`, { token: buyer.token });
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal(await stockOf(dress._id, 'S'), 1);

    const again = (await order(buyer.token, [{ productId: dress._id, size: 'S', quantity: 1 }])).json.orders[0];
    await api('PATCH', `/api/orders/${again._id}/status`, { token: sellerA.token, body: { status: 'confirmed' } });
    const late = await api('POST', `/api/orders/${again._id}/cancel`, { token: buyer.token });
    assert.equal(late.status, 409);
    const bySeller = await api('PATCH', `/api/orders/${again._id}/status`, { token: sellerA.token, body: { status: 'cancelled' } });
    assert.equal(bySeller.json.status, 'cancelled');
    assert.equal(await stockOf(dress._id, 'S'), 1);
  });
});

describe('product currency', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('currencyseller', { accountType: 'seller', storeName: 'Euro Shop' });
  });
  after(() => srv?.stop());

  it('tenge by default; another known currency can be set; an unknown one → 400', async () => {
    const make = (fields) => api('POST', '/api/products', {
      token: seller.token, files: { image: ['p.png', PNG] }, fields: { title: 'Bag', price: '49', garmentType: 'accessory', ...fields },
    });
    assert.equal((await make({})).json.currency, 'KZT');
    const eur = (await make({ currency: 'EUR' })).json;
    assert.equal(eur.currency, 'EUR');
    assert.equal((await make({ currency: 'XYZ' })).json.message, 'Unknown currency.');
    const changed = await api('PATCH', `/api/products/${eur._id}`, { token: seller.token, fields: { currency: 'USD' } });
    assert.equal(changed.json.currency, 'USD');
  });
});

describe('returns', () => {
  let srv, seller, buyer, product;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('returnseller', { accountType: 'seller', storeName: 'Return Shop' });
    buyer = await newUser('returnbuyer');
    product = (await api('POST', '/api/products', {
      token: seller.token, files: { image: ['p.png', PNG] },
      fields: { title: 'Coat', price: '30000', garmentType: 'outerwear', sizeChart: JSON.stringify([{ size: 'M', chest: 100, stock: 3 }]) },
    })).json;
  });
  after(() => srv?.stop());

  const stock = async () => (await api('GET', `/api/products/${product._id}`)).json.sizeChart[0].stock;

  it('only a delivered order; the reason and size zones are kept; the seller accepts, then receives — stock comes back', async () => {
    const order = (await api('POST', '/api/orders', {
      token: buyer.token, body: { items: [{ productId: product._id, size: 'M', quantity: 1 }], contact: CONTACT, address: ADDRESS },
    })).json.orders[0];
    const ask = (body) => api('POST', `/api/orders/${order._id}/return`, { token: buyer.token, body });
    assert.equal((await ask({ reason: 'size' })).status, 409);   // ещё не доставлен
    for (const status of ['confirmed', 'shipped', 'delivered']) {
      await api('PATCH', `/api/orders/${order._id}/status`, { token: seller.token, body: { status } });
    }
    assert.equal(await stock(), 2);
    assert.equal((await ask({ reason: 'nope' })).json.message, 'Please choose why you are returning the order.');
    const asked = (await ask({ reason: 'size', tooSmall: ['waist', 'hips', 'nose'], note: 'Tight at the waist' })).json;
    assert.deepEqual([asked.return.status, asked.return.tooSmall], ['requested', ['waist', 'hips']]);
    assert.equal((await ask({ reason: 'size' })).status, 409);   // повторно нельзя

    const move = (status) => api('PATCH', `/api/orders/${order._id}/return`, { token: seller.token, body: { status } });
    assert.equal((await move('received')).status, 409);   // сначала принять
    assert.equal((await move('accepted')).json.return.status, 'accepted');
    assert.equal((await move('received')).json.return.status, 'received');
    assert.equal(await stock(), 3);
  });
});
