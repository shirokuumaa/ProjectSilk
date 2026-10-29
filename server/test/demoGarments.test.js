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

  it('у платья — принт-гингем с повтором 4 см, остальные однотонные', async () => {
    const all = (await api('GET', '/api/products')).json;
    const byTitle = Object.fromEntries(all.map((p) => [p.title, p]));
    assert.deepEqual(byTitle['Short Sleeve Mini Dress'].print, { image: '/models/demo-garments/dress_print.png', tileCm: 4 });
    assert.equal(all.filter((p) => p.print).length, 1);
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
      // обмеры — из задания конвейера; остаток (stock) — свой у демо-товара
      const measures = byTitle[title].sizeChart.map(({ stock, ...r }) => r);
      assert.deepEqual(measures, chart.map(({ fit, ...r }) => ({ ...r, fit })), title);
    }
    assert.equal(byTitle['Lapel Jacket'].garmentType, 'outerwear');
    assert.equal(byTitle['Straight Trousers'].legs, 'split');
  });

  // 1,1 МБ: с развёрткой выкройки (UV и раздвоенные вершины швов) пальто XXL — 1,01 МБ (export_demo_drapes.py)
  it('файлы моделей и картинок на месте и не больше 1,1 МБ', () => {
    for (const p of demoProducts('x')) {
      for (const f of [p.image, p.print?.image, ...p.sizeModels.map((m) => m.model3d)].filter(Boolean)) {
        const file = path.join(PUBLIC, f);
        assert.ok(fs.existsSync(file), f);
        assert.ok(fs.statSync(file).size <= 1.1e6, `${f}: ${fs.statSync(file).size} байт`);
      }
    }
  });

  it('неизвестный продавец или покупатель — понятная ошибка', async () => {
    await newUser('demobuyer');
    await assert.rejects(seedDemoGarments('nobody'), /No user "nobody"/);
    await assert.rejects(seedDemoGarments('demobuyer'), /is not a seller/);
  });
});

describe('демо-товары: карточка для покупателя', () => {
  const ELASTIC = /elast|spandex|lycra/i;
  it('описание, состав на 100 %, уход и страна у каждого товара', () => {
    for (const p of demoProducts('x')) {
      assert.ok(p.description.length > 60, p.title);
      const total = p.composition.reduce((s, c) => s + c.percent, 0);
      assert.equal(total, 100, p.title);
      assert.ok(p.care && p.countryOfOrigin, p.title);
    }
  });

  it('у стрейч-платья — эластан; у вещей «No stretch» эластана нет', () => {
    const products = demoProducts('x');
    const elastane = (p) => p.composition.filter((c) => ELASTIC.test(c.fibre)).reduce((s, c) => s + c.percent, 0);
    const dress = products.find((p) => p.title === 'Short Sleeve Mini Dress');
    assert.ok(elastane(dress) >= 8);
    products.filter((p) => p.stretch === 'none').forEach((p) => assert.ok(elastane(p) < 3, p.title));
  });

  it('остаток у каждого размера: есть распроданный (0) и последние штуки (1–3)', () => {
    for (const p of demoProducts('x')) {
      const stock = p.sizeChart.map((r) => r.stock);
      assert.ok(stock.every(Number.isInteger), p.title);
      assert.ok(stock.includes(0), p.title);
      assert.ok(stock.some((n) => n >= 1 && n <= 3), p.title);
    }
  });
});
