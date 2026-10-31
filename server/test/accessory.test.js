// Карточка аксессуара и обуви: вид и размеры сохраняются; у обуви вид всегда shoes; размеры вне
// 0…300 см, нечисловой размер обуви и неизвестный вид — 400; у одежды карточки нет; список видов
// совпадает с клиентом (client/src/utils/accessoryKinds.js).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, newUser, PNG, SERVER_DIR } from './helpers.js';
import { ACCESSORY_KINDS, SIZE_SYSTEMS, parseAccessory } from '../utils/accessory.js';
import { DEMO_ACCESSORIES, demoAccessories } from '../scripts/seedDemoAccessories.js';

describe('accessory card', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('accseller', { accountType: 'seller', storeName: 'Acc Shop' });
  });
  after(() => srv?.stop());

  const create = (garmentType, accessory) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['item.png', PNG] },
    fields: { title: 'Item', price: '9900', garmentType, ...(accessory === undefined ? {} : { accessory: JSON.stringify(accessory) }) },
  });
  const patch = (id, fields) => api('PATCH', `/api/products/${id}`, { token: seller.token, files: {}, fields });

  it('a bag keeps its kind and sizes; extra fields are dropped', async () => {
    const r = await create('accessory', { kind: 'shoulder_bag', widthCm: '28', heightCm: 20, depthCm: '9,5', dropCm: 55, size: '7', side: 'r' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.accessory, { kind: 'shoulder_bag', widthCm: 28, heightCm: 20, depthCm: 9.5, dropCm: 55, side: 'r' });
  });

  it('shoes are always kind shoes, with the size and its system', async () => {
    const r = await create('shoes', { kind: 'watch', size: '38.5', sizeSystem: 'EU' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.accessory, { kind: 'shoes', size: '38.5', sizeSystem: 'EU' });
    const us = await create('shoes', { size: '7', sizeSystem: 'US-W' });
    assert.equal(us.json.accessory.sizeSystem, 'US-W');
  });

  it('bad cards → 400 with a message for the seller', async () => {
    const cases = [
      ['accessory', { kind: 'spaceship' }, 'Please choose the accessory kind.'],
      ['accessory', { kind: 'watch', widthCm: 400 }, 'Sizes must be between 0 and 300 cm.'],
      ['accessory', { kind: 'watch', widthCm: 'wide' }, 'Sizes must be between 0 and 300 cm.'],
      ['shoes', { size: 'M' }, 'Shoe size must be a number, e.g. 38 or 38.5.'],
      ['shoes', { size: '38', sizeSystem: 'JP' }, 'Unknown size system.'],
      ['accessory', { kind: 'hat', size: '12' }, 'Hat size is the head circumference, 40–70 cm.'],
      ['accessory', { kind: 'belt', level: 'neck' }, 'A belt is worn at the waist or on the hips.'],
    ];
    for (const [type, card, message] of cases) {
      const r = await create(type, card);
      assert.equal(r.status, 400, JSON.stringify(card));
      assert.equal(r.json.message, message);
    }
  });

  it('clothes have no card; changing the type drops a card that no longer fits', async () => {
    const dress = await create('dress', { kind: 'watch', widthCm: 4 });
    assert.equal(dress.status, 201);
    assert.equal(dress.json.accessory, undefined);

    const watch = await create('accessory', { kind: 'watch', widthCm: 4 });
    const toDress = await patch(watch.json._id, { garmentType: 'dress' });
    assert.equal(toDress.status, 200);
    assert.equal(toDress.json.accessory, undefined);

    const ring = await create('accessory', { kind: 'ring', size: 54, sizeSystem: 'EU' });
    const resized = await patch(ring.json._id, { accessory: JSON.stringify({ kind: 'ring', size: 7, sizeSystem: 'US' }) });
    assert.deepEqual(resized.json.accessory, { kind: 'ring', size: '7', sizeSystem: 'US' });
    const cleared = await patch(ring.json._id, { accessory: '' });
    assert.equal(cleared.json.accessory, undefined);
  });

  it('kinds, fields and size systems match the client', () => {
    const client = fs.readFileSync(path.join(SERVER_DIR, '..', 'client', 'src', 'utils', 'accessoryKinds.js'), 'utf8');
    const block = client.slice(client.indexOf('export const ACCESSORY_KINDS'), client.indexOf('};', client.indexOf('export const ACCESSORY_KINDS')));
    for (const [kind, fields] of Object.entries(ACCESSORY_KINDS)) {
      const line = block.split('\n').find((l) => l.trim().startsWith(`${kind}:`));
      assert.ok(line, `client has no kind ${kind}`);
      assert.match(line, new RegExp(`fields: \\[${fields.map((f) => `'${f}'`).join(', ')}\\]`), kind);
      if (SIZE_SYSTEMS[kind]) assert.match(line, new RegExp(`sizeSystems: \\[${SIZE_SYSTEMS[kind].map((s) => `'${s}'`).join(', ')}\\]`), kind);
    }
    assert.equal(block.split('\n').filter((l) => /^\s+\w+:\s+\{ label/.test(l)).length, Object.keys(ACCESSORY_KINDS).length);
  });

  it('parseAccessory: an empty card removes it', () => {
    assert.deepEqual(parseAccessory('', 'accessory'), { accessory: null });
    assert.deepEqual(parseAccessory(undefined, 'shoes'), { accessory: null });
    assert.deepEqual(parseAccessory('{oops', 'accessory'), { error: 'Accessory details are not readable.' });
  });

  it('demo accessories: every prepared model becomes a product with a valid card; shoes are shoes', () => {
    const prepared = [
      { item: '01_earrings', kind: 'earrings', file: '01_earrings.glb', card: { lengthCm: 5.5 } },
      { item: '07_sneakers', kind: 'shoes', file: '07_sneakers.glb', card: { size: '38', sizeSystem: 'EU' } },
      { item: '05_belt', kind: 'belt', file: '05_belt.glb', card: { widthCm: 3.5, lengthCm: 95, level: 'waist' } },
      { item: '03_ring', kind: 'ring', file: '03_ring.glb', card: { size: '7' } },   // кольца нет среди демо
    ];
    const docs = demoAccessories('x', prepared);
    assert.deepEqual(docs.map((d) => d.title), ['Beaded Hoop Drop Earrings', 'Black Canvas Sneakers', 'Black Leather Belt']);
    assert.deepEqual(docs.map((d) => d.garmentType), ['accessory', 'shoes', 'accessory']);
    assert.deepEqual(docs[1].accessory, { kind: 'shoes', size: '38', sizeSystem: 'EU' });
    assert.deepEqual(docs[2].accessory, { kind: 'belt', widthCm: 3.5, lengthCm: 95, level: 'waist' });
    assert.equal(docs[0].model3d, '/models/demo-accessories/01_earrings.glb');
    assert.equal(docs[2].color, '#1c1c1e');            // лента ремня — цвета товара
    assert.equal(Object.keys(DEMO_ACCESSORIES).length, 9);
  });
});
