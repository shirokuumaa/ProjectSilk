// Демо-товары с настоящей тканью: сетки из дня 7 и открытых таблиц, модель на каждый размер, файлы до 1 МБ.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { startTestServer, api, newUser, TEST_MONGO_URI, SERVER_DIR } from './helpers.js';
import { seedDemoGarments, demoProducts } from '../scripts/seedDemoGarments.js';

const PUBLIC = path.resolve(SERVER_DIR, '../client/public');

describe('демо-товары: платье, юбка, футболка, брюки, жакет, пальто с моделями размеров', () => {
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

  it('шесть товаров, повторный запуск их обновляет, а не дублирует', async () => {
    const all = (await api('GET', '/api/products')).json;
    assert.deepEqual(all.map((p) => p.title).sort(), ['Crew Neck T-Shirt', 'Flared Midi Skirt', 'Knee-Length Coat',
      'Lapel Jacket', 'Short Sleeve Mini Dress', 'Straight Trousers']);
  });

  it('у каждого — модель на каждый размер сетки, с фигурой, на которой считалась ткань', async () => {
    for (const p of products) {
      const r = (await api('GET', `/api/products/${p._id}`)).json;
      assert.deepEqual(r.sizeModels.map((m) => m.size), r.sizeChart.map((row) => row.size));
      r.sizeModels.forEach((m) => {
        assert.match(m.model3d, new RegExp(`^/models/demo-garments/(dress|skirt|tee|trousers|jacket|coat)_${m.size}\\.glb$`));
        assert.equal(m.body.heightCm, 166);
      });
      assert.equal(r.model3d, r.sizeModels.find((m) => m.size === 'S').model3d);
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

  it('брюки, жакет, пальто: сетки заданий конвейера (research/patterns/demo), у верхней одежды — плечи', () => {
    const byTitle = Object.fromEntries(demoProducts('x').map((p) => [p.title, p]));
    const root = path.resolve(SERVER_DIR, '../research/patterns/demo');
    for (const [title, job] of [['Straight Trousers', 'trousers'], ['Lapel Jacket', 'jacket'], ['Knee-Length Coat', 'coat']]) {
      const chart = JSON.parse(fs.readFileSync(path.join(root, `${job}_job.json`), 'utf8')).sizeChart;
      assert.deepEqual(byTitle[title].sizeChart, chart.map(({ fit, ...r }) => ({ ...r, fit })), title);
    }
    assert.equal(byTitle['Lapel Jacket'].garmentType, 'outerwear');
    assert.equal(byTitle['Straight Trousers'].legs, 'split');
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
