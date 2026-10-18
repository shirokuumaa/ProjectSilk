// CORS для редактирования товара из браузера: preflight пропускает PATCH с адреса клиента,
// сам PATCH меняет размерную сетку, чужой адрес разрешения не получает.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, BASE, PNG } from './helpers.js';

const CLIENT = 'http://localhost:3011'; // CORS_ORIGINS тестового сервера

const preflight = (origin, method = 'PATCH') =>
  fetch(`${BASE}/api/products/anything`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': 'authorization',
    },
  });

describe('CORS: редактирование товара из браузера', () => {
  let srv, seller, product;

  before(async () => {
    srv = await startTestServer();
    seller = await newUser('corsseller', { accountType: 'seller', storeName: 'Cors Shop' });
    const r = await api('POST', '/api/products', {
      token: seller.token,
      files: { image: ['tee.png', PNG] },
      fields: {
        title: 'Tee', price: '9900', garmentType: 'top',
        sizeChart: JSON.stringify([{ size: 'S', chest: 92 }, { size: 'M', chest: 96 }]),
      },
    });
    assert.equal(r.status, 201);
    product = r.json;
  });
  after(() => srv?.stop());

  it('preflight с адреса клиента разрешает PATCH и заголовок Authorization', async () => {
    const r = await preflight(CLIENT);
    assert.ok(r.status === 204 || r.status === 200, `status ${r.status}`);
    assert.equal(r.headers.get('access-control-allow-origin'), CLIENT);
    assert.match(r.headers.get('access-control-allow-methods') || '', /\bPATCH\b/);
    assert.match((r.headers.get('access-control-allow-headers') || '').toLowerCase(), /authorization/);
  });

  it('чужой адрес не получает разрешения', async () => {
    const r = await preflight('http://evil.example');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  it('PATCH с адреса клиента меняет название и размерную сетку', async () => {
    const r = await api('PATCH', `/api/products/${product._id}`, {
      token: seller.token,
      headers: { Origin: CLIENT },
      fields: {
        title: 'Tee v2',
        sizeChart: JSON.stringify([{ size: 'S', chest: 92 }, { size: 'M', chest: 97 }, { size: 'L', chest: 102 }]),
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.title, 'Tee v2');
    assert.deepEqual(r.json.sizeChart.map((s) => [s.size, s.chest]), [['S', 92], ['M', 97], ['L', 102]]);

    const after = await api('GET', `/api/products/${product._id}`);
    assert.equal(after.json.sizeChart.length, 3);
  });
});
