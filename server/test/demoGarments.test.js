// Демо-товары с настоящей тканью: сетки из дня 7, модели S и L у товара, файлы до 1 МБ.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { startTestServer, api, newUser, TEST_MONGO_URI, SERVER_DIR } from './helpers.js';
import { seedDemoGarments, demoProducts } from '../scripts/seedDemoGarments.js';

const PUBLIC = path.resolve(SERVER_DIR, '../client/public');

describe('демо-товары: платье, юбка, футболка с моделями размеров', () => {
  let srv, products;

  before(async () => {
    srv = await startTestServer();
    await newUser('demoshop', { accountType: 'seller', storeName: 'Demo Shop' });
    await mongoose.connect(TEST_MONGO_URI);
    products = await seedDemoGarments('demoshop');
    await seedDemoGarments('demoshop'); // повторный запуск не плодит копии
  });
  after(async () => {
    await mongoose.disconnect();
    await srv?.stop();
  });

  it('три товара, повторный запуск их обновляет, а не дублирует', async () => {
    const all = (await api('GET', '/api/products')).json;
    assert.deepEqual(all.map((p) => p.title).sort(), ['Crew Neck T-Shirt', 'Flared Midi Skirt', 'Short Sleeve Mini Dress']);
  });

  it('у каждого — модели S и L с фигурой, на которой считалась ткань', async () => {
    for (const p of products) {
      const r = (await api('GET', `/api/products/${p._id}`)).json;
      assert.deepEqual(r.sizeModels.map((m) => m.size), ['S', 'L']);
      r.sizeModels.forEach((m) => {
        assert.match(m.model3d, /^\/models\/demo-garments\/(dress|skirt|tee)_(S|L)\.glb$/);
        assert.equal(m.body.heightCm, 166);
      });
      assert.equal(r.model3d, r.sizeModels[0].model3d);
    }
  });

  it('сетки из дня 7: платье Zara (× 2, stretchy), юбка, футболка Uniqlo (рукав от плечевого шва)', () => {
    const [dress, skirt, tee] = demoProducts('x');
    const S = (p) => p.sizeChart.find((r) => r.size === 'S');
    assert.deepEqual([S(dress).chest, S(dress).waist, S(dress).hips, S(dress).length], [80, 66, 85, 83]);
    assert.equal(dress.stretch, 'stretchy');
    assert.deepEqual([S(skirt).waist, S(skirt).hips, S(skirt).length], [74, 102, 80]);
    assert.deepEqual([S(tee).chest, S(tee).length, S(tee).sleeve], [86, 61.5, 16.5]);
  });

  it('файлы моделей и картинок на месте и не больше 1 МБ', () => {
    for (const p of demoProducts('x')) {
      for (const f of [p.image, ...p.sizeModels.map((m) => m.model3d)]) {
        const file = path.join(PUBLIC, f);
        assert.ok(fs.existsSync(file), f);
        assert.ok(fs.statSync(file).size <= 1e6, `${f}: ${fs.statSync(file).size} байт`);
      }
    }
  });

  it('неизвестный продавец или покупатель — понятная ошибка', async () => {
    await newUser('demobuyer');
    await assert.rejects(seedDemoGarments('nobody'), /No user "nobody"/);
    await assert.rejects(seedDemoGarments('demobuyer'), /is not a seller/);
  });
});
