// Силуэт товара: тот же список, что у клиента и в research/patterns/templates.py;
// проверка формы продавца; хранение у товара.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, newUser, PNG, SERVER_DIR } from './helpers.js';
import { SILHOUETTE_TEMPLATES, parseSilhouette } from '../utils/silhouettes.js';

const ROOT = path.resolve(SERVER_DIR, '..');

describe('silhouette list', () => {
  const ours = Object.values(SILHOUETTE_TEMPLATES).flat().sort();

  it('matches the 8 templates of research/patterns/templates.py', () => {
    const py = fs.readFileSync(path.join(ROOT, 'research/patterns/templates.py'), 'utf8');
    const block = py.slice(py.indexOf('TEMPLATES = {'), py.indexOf('\n}\n', py.indexOf('TEMPLATES = {')));
    const names = [...block.matchAll(/^\s+"(\w+)": \{"type"/gm)].map((m) => m[1]).sort();
    assert.equal(names.length, 8);
    assert.deepEqual(ours, names);
  });

  it('matches the client list, and every template has a picture', () => {
    const js = fs.readFileSync(path.join(ROOT, 'client/src/utils/silhouettes.js'), 'utf8');
    const names = [...js.matchAll(/template: '(\w+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(names, ours);
    for (const t of ours) assert.ok(fs.existsSync(path.join(ROOT, 'client/public/silhouettes', `${t}.png`)), t);
  });
});

describe('parseSilhouette', () => {
  it('empty or "null" — no silhouette', () => {
    for (const raw of [undefined, '', 'null', null]) assert.deepEqual(parseSilhouette(raw, 'dress'), { silhouette: null });
  });

  it('fills the template defaults and keeps only the knobs of the type', () => {
    assert.deepEqual(parseSilhouette('{"template":"dress_aline"}', 'dress').silhouette,
      { template: 'dress_aline', sleeve: 'short', length: 'knee' });
    assert.deepEqual(parseSilhouette({ template: 'skirt_flared', sleeve: 'long', length: 'midi' }, 'bottom').silhouette,
      { template: 'skirt_flared', length: 'midi' });
  });

  it('a silhouette of another type or unknown knobs — error', () => {
    assert.ok(parseSilhouette('{"template":"skirt_aline"}', 'dress').error);
    assert.ok(parseSilhouette('{"template":"dress_aline"}', 'outerwear').error);
    assert.ok(parseSilhouette('{"template":"top_loose","sleeve":"cap"}', 'top').error);
    assert.ok(parseSilhouette('{"template":"top_loose","length":"maxi"}', 'top').error);
    assert.ok(parseSilhouette('{oops', 'top').error);
  });
});

describe('silhouette on a product', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();
    seller = await newUser('silseller', { accountType: 'seller', storeName: 'Sil Shop' });
  });
  after(() => srv?.stop());

  const create = (fields) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['dress.png', PNG] },
    fields: { title: 'Wrap Dress', price: '19900', ...fields },
  });

  it('is saved with the product', async () => {
    const r = await create({ garmentType: 'dress', silhouette: JSON.stringify({ template: 'dress_flared', sleeve: 'none', length: 'midi' }) });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.silhouette, { template: 'dress_flared', sleeve: 'none', length: 'midi' });
  });

  it('of another type → 400', async () => {
    const r = await create({ garmentType: 'top', silhouette: JSON.stringify({ template: 'dress_flared' }) });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /silhouette/);
  });

  it('is dropped when the garment type changes to one it does not fit', async () => {
    const p = (await create({ garmentType: 'dress', silhouette: JSON.stringify({ template: 'dress_aline' }) })).json;
    const r = await api('PATCH', `/api/products/${p._id}`, { token: seller.token, body: { garmentType: 'outerwear' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.silhouette, undefined);
  });
});
