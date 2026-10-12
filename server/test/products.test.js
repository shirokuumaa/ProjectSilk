// Роль продавца, владельцы товаров, проверка загружаемых файлов.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  startTestServer, api, register, newUser, PNG, JPEG, GLB, EXE,
} from './helpers.js';

const MB = 1024 * 1024;

function createProduct(token, { title = 'Silk dress', price = '25000', image = ['dress.png', PNG], model } = {}) {
  const files = {};
  if (image) files.image = image;
  if (model) files.model3d = model;
  return api('POST', '/api/products', {
    token,
    files,
    fields: {
      title,
      price,
      garmentType: 'dress',
      sizeChart: JSON.stringify([{ size: 'M', chest: 92, waist: 74, hips: 98 }]),
    },
  });
}

describe('products', () => {
  let srv, buyer, sellerA, sellerB;

  before(async () => {
    srv = await startTestServer();
    buyer = await newUser('bella');
    sellerA = await newUser('sellera', { accountType: 'seller', storeName: '  Silk   Studio ' });
    sellerB = await newUser('sellerb', { accountType: 'seller', storeName: 'Other Shop' });
  });
  after(() => srv?.stop());

  describe('роли', () => {
    it('продавцу нужно название магазина', async () => {
      assert.equal((await register('nostore', { accountType: 'seller' })).status, 400);
    });

    it('неизвестный тип аккаунта → 400', async () => {
      assert.equal((await register('hacker', { accountType: 'admin' })).status, 400);
    });

    it('продавец получает роль и нормализованное название магазина', () => {
      assert.equal(sellerA.user.role, 'seller');
      assert.equal(sellerA.user.storeName, 'Silk Studio');
    });
  });

  describe('создание товара', () => {
    it('без токена → 401, покупатель → 403, файлы не записываются', async () => {
      const before = srv.countFiles();
      assert.equal((await createProduct(null)).status, 401);
      assert.equal((await createProduct(buyer.token)).status, 403);
      assert.equal(srv.countFiles(), before);
    });

    it('продавец создаёт товар и становится его владельцем', async () => {
      const r = await createProduct(sellerA.token, { model: ['dress.glb', GLB] });
      assert.equal(r.status, 201);
      assert.equal(r.json.owner, sellerA.user.id);
      assert.ok(fs.existsSync(srv.diskPath(r.json.image)));
      assert.ok(fs.existsSync(srv.diskPath(r.json.model3d)));

      const img = await fetch(`http://localhost:5055${r.json.image}`);
      assert.equal(img.status, 200);
    });
  });

  describe('проверка файлов', () => {
    const cases = [
      ['exe под видом .png', { image: ['evil.png', EXE] }, 400],
      ['.gif', { image: ['pic.gif', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])] }, 400],
      ['.html с PNG-заголовком', { image: ['x.html', PNG] }, 400],
      ['картинка больше 10 МБ', { image: ['big.png', Buffer.concat([PNG, Buffer.alloc(11 * MB)])] }, 413],
      ['.obj вместо .glb', { model: ['m.obj', Buffer.from('v 0 0 0\n')] }, 400],
      ['.glb с чужим содержимым', { model: ['m.glb', Buffer.from('abcd'.repeat(20))] }, 400],
      ['модель больше 50 МБ', { model: ['huge.glb', Buffer.concat([GLB, Buffer.alloc(51 * MB)])] }, 413],
      ['без картинки', { image: null }, 400],
      ['без названия', { title: '' }, 400],
      ['цена «abc»', { price: 'abc' }, 400],
    ];

    for (const [name, opts, status] of cases) {
      it(`${name} → ${status}, файлы удалены`, async () => {
        const before = srv.countFiles();
        assert.equal((await createProduct(sellerA.token, opts)).status, status);
        assert.equal(srv.countFiles(), before);
      });
    }
  });

  describe('изменение и удаление', () => {
    let product;

    before(async () => {
      product = (await createProduct(sellerA.token, { model: ['dress.glb', GLB] })).json;
    });

    it('чужой продавец, покупатель и гость не могут изменить', async () => {
      const patch = { body: { title: 'Hacked' } };
      assert.equal((await api('PATCH', `/api/products/${product._id}`, { ...patch, token: sellerB.token })).status, 403);
      assert.equal((await api('PATCH', `/api/products/${product._id}`, { ...patch, token: buyer.token })).status, 403);
      assert.equal((await api('PATCH', `/api/products/${product._id}`, patch)).status, 401);
    });

    it('файл от чужого продавца не записывается', async () => {
      const before = srv.countFiles();
      const r = await api('PATCH', `/api/products/${product._id}`, { token: sellerB.token, files: { image: ['x.png', PNG] } });
      assert.equal(r.status, 403);
      assert.equal(srv.countFiles(), before);
    });

    it('владелец меняет поля, но не владельца', async () => {
      const r = await api('PATCH', `/api/products/${product._id}`, {
        token: sellerA.token,
        body: { title: 'Silk dress v2', price: '27000', owner: sellerB.user.id },
      });
      assert.equal(r.status, 200);
      assert.equal(r.json.title, 'Silk dress v2');
      assert.equal(r.json.price, 27000);
      assert.equal(r.json.owner, sellerA.user.id);
    });

    it('замена картинки удаляет старый файл', async () => {
      const current = (await api('GET', `/api/products/${product._id}`)).json;
      const oldPath = srv.diskPath(current.image);
      const r = await api('PATCH', `/api/products/${product._id}`, { token: sellerA.token, files: { image: ['new.jpg', JPEG] } });
      assert.equal(r.status, 200);
      assert.ok(fs.existsSync(srv.diskPath(r.json.image)));
      assert.equal(fs.existsSync(oldPath), false);
    });

    it('/mine показывает только свои товары', async () => {
      const other = (await createProduct(sellerB.token, { title: "B's coat" })).json;
      const mine = (await api('GET', '/api/products/mine', { token: sellerA.token })).json.map((p) => p._id);
      assert.ok(mine.includes(product._id));
      assert.equal(mine.includes(other._id), false);
      assert.equal((await api('GET', '/api/products/mine', { token: buyer.token })).status, 403);
      assert.equal((await api('GET', '/api/products/mine')).status, 401);
    });

    it('чужой продавец и покупатель не могут удалить', async () => {
      assert.equal((await api('DELETE', `/api/products/${product._id}`, { token: sellerB.token })).status, 403);
      assert.equal((await api('DELETE', `/api/products/${product._id}`, { token: buyer.token })).status, 403);
    });

    it('владелец удаляет товар вместе с файлами', async () => {
      const current = (await api('GET', `/api/products/${product._id}`)).json;
      const files = [srv.diskPath(current.image), srv.diskPath(current.model3d)];
      assert.equal((await api('DELETE', `/api/products/${product._id}`, { token: sellerA.token })).status, 200);
      assert.deepEqual(files.map((f) => fs.existsSync(f)), [false, false]);
      assert.equal((await api('GET', `/api/products/${product._id}`)).status, 404);
    });

    it('кривой и несуществующий id → 404', async () => {
      assert.equal((await api('GET', '/api/products/not-an-id')).status, 404);
      assert.equal((await api('DELETE', '/api/products/64b000000000000000000000', { token: sellerA.token })).status, 404);
    });

    it('каталог открыт без токена', async () => {
      assert.equal((await api('GET', '/api/products')).status, 200);
    });
  });

  describe('Become a seller', () => {
    it('слишком короткое название → 400', async () => {
      const r = await api('POST', '/api/auth/become-seller', { token: buyer.token, body: { storeName: 'B' } });
      assert.equal(r.status, 400);
    });

    it('без токена → 401', async () => {
      assert.equal((await api('POST', '/api/auth/become-seller', { body: { storeName: 'Shop' } })).status, 401);
    });

    it('покупатель становится продавцом и сразу, тем же токеном, создаёт товар', async () => {
      const r = await api('POST', '/api/auth/become-seller', { token: buyer.token, body: { storeName: 'Bella Boutique' } });
      assert.equal(r.status, 200);
      assert.equal(r.json.user.role, 'seller');
      assert.equal((await createProduct(buyer.token, { title: 'Bella skirt' })).status, 201);
    });

    it('повторно → 409', async () => {
      const r = await api('POST', '/api/auth/become-seller', { token: buyer.token, body: { storeName: 'X shop' } });
      assert.equal(r.status, 409);
    });
  });
});
