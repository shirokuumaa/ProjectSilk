// «Flat (half) width»: продавец даёт ширину изделия в разложенном виде — сервер хранит полный обхват (× 2).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, PNG } from './helpers.js';

// Zara Stretch Maxi Dress, замеры в разложенном виде (research/photos/02_dress)
const FLAT = [
  { size: 'S', chest: 36.5, waist: 31, hips: 40, length: 138, sleeve: 66, fit: 'tight' },
  { size: 'M', chest: 37.5, waist: 32.5, hips: 41, length: 140, sleeve: 67, fit: 'tight' },
];

describe('размерная сетка: полный обхват или ширина в разложенном виде', () => {
  let srv, seller;

  const create = (fields) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['dress.png', PNG] },
    fields: { title: 'Stretch dress', price: '24900', garmentType: 'dress', stretch: 'stretchy', ...fields },
  });

  before(async () => {
    srv = await startTestServer();
    seller = await newUser('girthseller', { accountType: 'seller', storeName: 'Girth Shop' });
  });
  after(() => srv?.stop());

  it('flat: грудь, талия и бёдра × 2, длина и рукав как есть', async () => {
    const r = await create({ girthMode: 'flat', sizeChart: JSON.stringify(FLAT) });
    assert.equal(r.status, 201);
    const [s, m] = r.json.sizeChart;
    assert.deepEqual([s.chest, s.waist, s.hips, s.length, s.sleeve], [73, 62, 80, 138, 66]);
    assert.deepEqual([m.chest, m.waist, m.hips], [75, 65, 82]);
  });

  it('по умолчанию и при «circumference» числа не меняются', async () => {
    const full = FLAT.map((r) => ({ ...r, chest: r.chest * 2, waist: r.waist * 2, hips: r.hips * 2 }));
    for (const fields of [{}, { girthMode: 'circumference' }]) {
      const r = await create({ ...fields, sizeChart: JSON.stringify(full) });
      assert.equal(r.status, 201);
      assert.deepEqual(r.json.sizeChart.map((x) => x.chest), [73, 75]);
    }
  });

  it('PATCH с flat тоже умножает', async () => {
    const p = (await create({ sizeChart: JSON.stringify([{ size: 'S', waist: 70 }]) })).json;
    const r = await api('PATCH', `/api/products/${p._id}`, {
      token: seller.token, fields: { girthMode: 'flat', sizeChart: JSON.stringify([{ size: 'S', waist: 31, length: 138 }]) },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.sizeChart[0].waist, 62);
    assert.equal(r.json.sizeChart[0].length, 138);
  });

  it('неизвестный способ → 400', async () => {
    const r = await create({ girthMode: 'diagonal', sizeChart: JSON.stringify(FLAT) });
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Measurements must be given as full circumference or flat width.');
  });
});
