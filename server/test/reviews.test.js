// Отзывы о посадке: только после доставки и только своё, один раз на вещь; сводка «в размер»;
// «люди с похожей фигурой» — только когда похожих хотя бы трое; обмеры авторов наружу не уходят.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, PNG } from './helpers.js';

const CONTACT = { name: 'Test Buyer', phone: '+7 700 000 00 00' };
const ADDRESS = { country: 'KZ', city: 'Almaty', line1: 'Test street 1' };
const CHART = [{ size: 'S', chest: 86 }, { size: 'M', chest: 90 }];

describe('fit reviews', () => {
  let srv, seller, product;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('reviewseller', { accountType: 'seller', storeName: 'Review Shop' });
    product = (await api('POST', '/api/products', {
      token: seller.token, files: { image: ['p.png', PNG] },
      fields: { title: 'Dress', price: '10000', garmentType: 'dress', sizeChart: JSON.stringify(CHART) },
    })).json;
  });
  after(() => srv?.stop());

  /** Покупатель с обмерами и доставленным заказом вещи в размере size. */
  async function delivered(name, body, size) {
    const buyer = await newUser(name);
    await api('POST', '/api/body-profile', { token: buyer.token, body });
    const order = (await api('POST', '/api/orders', {
      token: buyer.token, body: { items: [{ productId: product._id, size, quantity: 1 }], contact: CONTACT, address: ADDRESS },
    })).json.orders[0];
    for (const status of ['confirmed', 'shipped', 'delivered']) {
      await api('PATCH', `/api/orders/${order._id}/status`, { token: seller.token, body: { status } });
    }
    return { buyer, order };
  }
  const review = (who, order, extra = {}) => api('POST', '/api/reviews', {
    token: who.token, body: { orderId: order._id, productId: product._id, size: 'M', rating: 5, fit: 'true', ...extra },
  });

  it('only after delivery, only the buyer, once per item; the product rating follows', async () => {
    const buyer = await newUser('earlyreviewer');
    const placed = (await api('POST', '/api/orders', {
      token: buyer.token, body: { items: [{ productId: product._id, size: 'M', quantity: 1 }], contact: CONTACT, address: ADDRESS },
    })).json.orders[0];
    assert.equal((await review(buyer, placed)).status, 409);

    const { buyer: b1, order } = await delivered('reviewer1', { heightCm: 166, chest: 88, waist: 70, hips: 96 }, 'M');
    const stranger = await newUser('strangerreviewer');
    assert.equal((await review(stranger, order)).status, 404);
    const bad = await review(b1, order, { rating: 0, fit: 'meh', zones: { waist: 'huge' } });
    assert.deepEqual(bad.json.errors, ['Please rate the item from 1 to 5 stars.', 'Please say how the size fits.', 'Unknown answer for waist.']);

    const ok = await review(b1, order, { rating: 4, zones: { waist: 'loose', bust: 'ok' }, text: 'Lovely, a bit loose at the waist.' });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.author, 'R.');
    assert.equal(ok.json.heightCm, 166);
    assert.equal(ok.json.body, undefined);   // обхваты автора не отдаём
    assert.equal((await review(b1, order)).status, 409);
    const p = (await api('GET', `/api/products/${product._id}`)).json;
    assert.deepEqual([p.rating, p.reviewCount], [4, 1]);
  });

  it('the product summary counts runs small / true to size / runs large', async () => {
    const { buyer, order } = await delivered('reviewer2', { heightCm: 168, chest: 89, waist: 71, hips: 97 }, 'M');
    await review(buyer, order, { rating: 5, fit: 'small' });
    const r = (await api('GET', `/api/reviews/product/${product._id}`)).json;
    assert.equal(r.summary.count, 2);
    assert.equal(r.summary.rating, 4.5);
    assert.deepEqual(r.summary.fit, { small: 1, true: 1, large: 0 });
    assert.ok(r.reviews.every((x) => x.body === undefined));
  });

  it('"people with a similar figure" appears only from three similar reviews', async () => {
    const me = await newUser('similarasker');
    await api('POST', '/api/body-profile', { token: me.token, body: { heightCm: 167, chest: 88, waist: 70, hips: 96 } });
    const before = (await api('GET', `/api/reviews/similar/${product._id}`, { token: me.token })).json;
    assert.deepEqual(before, { count: 2, enough: false });

    const { buyer, order } = await delivered('reviewer3', { heightCm: 165, chest: 87, waist: 69, hips: 95 }, 'M');
    await review(buyer, order, { fit: 'true' });
    // далёкая фигура не считается
    const far = await delivered('reviewer4', { heightCm: 180, chest: 104, waist: 90, hips: 110 }, 'M');
    await review(far.buyer, far.order, { fit: 'true' });

    const after = (await api('GET', `/api/reviews/similar/${product._id}`, { token: me.token })).json;
    assert.deepEqual(after, { enough: true, count: 3, size: 'M', sizeCount: 2, trueToSize: 2 });
    assert.equal((await api('GET', `/api/reviews/similar/${product._id}`)).status, 401);
  });
});
