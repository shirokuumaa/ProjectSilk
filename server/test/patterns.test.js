// Выкройки товара в фоне: статус queued → patterns_ready / failed, пересборка при изменении,
// уборка при удалении. Python подменён test/fixtures/fakePatternsJob.mjs; настоящий прогон
// конвейера — scripts/garments/patterns_job.py на Mac (см. отчёт этапа 1).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, newUser, PNG, SERVER_DIR } from './helpers.js';
import { outcome } from '../services/patternJobs.js';

const FAKE = path.join(SERVER_DIR, 'test/fixtures/fakePatternsJob.mjs');
const CHART = [{ size: 'S', chest: 88, waist: 70, hips: 94 }, { size: 'M', chest: 92, waist: 74, hips: 98 }];
const SIL = { template: 'dress_aline', sleeve: 'short', length: 'knee' };

async function until(fn, ms = 20000) {   // с запасом: под нагрузкой процесс стартует медленнее
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('pattern jobs', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer({ env: { PATTERN_PYTHON: process.execPath, PATTERN_SCRIPT: FAKE } });
    seller = await newUser('patseller', { accountType: 'seller', storeName: 'Pattern Shop' });
  });
  after(() => srv?.stop());

  const create = (title, fields = {}) => api('POST', '/api/products', {
    token: seller.token,
    files: { image: ['dress.png', PNG] },
    fields: { title, price: '19900', garmentType: 'dress', silhouette: JSON.stringify(SIL), sizeChart: JSON.stringify(CHART), ...fields },
  });
  const get = async (id) => (await api('GET', `/api/products/${id}`)).json;
  const settled = (id) => until(async () => {
    const p = await get(id);
    return p.patterns?.status !== 'queued' ? p : null;
  });

  it('a product with a silhouette and a size chart is queued and gets patterns for every size', async () => {
    const r = await create('Wrap Dress');
    assert.equal(r.status, 201);
    assert.equal(r.json.patterns.status, 'queued');

    const p = await settled(r.json._id);
    assert.equal(p.patterns.status, 'patterns_ready');
    assert.deepEqual(p.patterns.sizes.map((s) => [s.size, s.ok]), [['S', true], ['M', true]]);

    // задача получила товар целиком: тип, силуэт, сетку, тянучесть
    const job = JSON.parse(fs.readFileSync(path.join(srv.patternsDir, p._id, 'result.json'), 'utf8')).seenJob;
    assert.equal(job.garmentType, 'dress');
    assert.deepEqual(job.silhouette, SIL);
    assert.deepEqual(job.sizeChart.map((s) => s.size), ['S', 'M']);
    assert.equal(job.stretch, 'none');
  });

  it('no silhouette or no size chart — no patterns', async () => {
    const a = await create('Plain Dress', { silhouette: '' });
    const b = await create('Chartless Dress', { sizeChart: '[]' });
    assert.equal(a.json.patterns, undefined);
    assert.equal(b.json.patterns, undefined);
  });

  it('when no size can be drafted the status is failed with the reason for the seller', async () => {
    const p = await settled((await create('fail dress')).json._id);
    assert.equal(p.patterns.status, 'failed');
    assert.equal(p.patterns.message, 'This size is outside the body range we can model yet.');
    assert.deepEqual(p.patterns.sizes.map((s) => s.ok), [false, false]);
  });

  it('a crashed process is failed without the traceback', async () => {
    const p = await settled((await create('crash dress')).json._id);
    assert.equal(p.patterns.status, 'failed');
    assert.equal(p.patterns.message, 'Could not draft the patterns.');
  });

  it('changing the size chart rebuilds; changing only the price does not', async () => {
    const id = (await create('Edit Dress')).json._id;
    await settled(id);
    const price = await api('PATCH', `/api/products/${id}`, { token: seller.token, body: { price: 25000 } });
    assert.equal(price.json.patterns.status, 'patterns_ready');

    const chart = await api('PATCH', `/api/products/${id}`, {
      token: seller.token, body: { sizeChart: JSON.stringify([...CHART, { size: 'L', chest: 96, waist: 78, hips: 102 }]) },
    });
    assert.equal(chart.json.patterns.status, 'queued');
    const p = await settled(id);
    assert.deepEqual(p.patterns.sizes.map((s) => s.size), ['S', 'M', 'L']);
  });

  it('an edit during a build wins: the stale result is not applied', async () => {
    const id = (await create('slow dress')).json._id;
    await new Promise((r) => setTimeout(r, 300));            // сборка идёт
    await api('PATCH', `/api/products/${id}`, { token: seller.token, body: { title: 'Wrap Dress v2' } });
    await api('PATCH', `/api/products/${id}`, {
      token: seller.token, body: { silhouette: JSON.stringify({ ...SIL, length: 'midi' }) },
    });
    const p = await settled(id);
    assert.equal(p.patterns.status, 'patterns_ready');
    const job = JSON.parse(fs.readFileSync(path.join(srv.patternsDir, id, 'result.json'), 'utf8')).seenJob;
    assert.equal(job.silhouette.length, 'midi');
  });

  it('removing the silhouette drops the patterns; deleting the product removes its files', async () => {
    const id = (await create('Gone Dress')).json._id;
    await settled(id);
    assert.ok(fs.existsSync(path.join(srv.patternsDir, id)));
    const r = await api('PATCH', `/api/products/${id}`, { token: seller.token, body: { silhouette: '' } });
    assert.equal(r.json.patterns, undefined);
    assert.ok(!fs.existsSync(path.join(srv.patternsDir, id)));

    const id2 = (await create('Deleted Dress')).json._id;
    await settled(id2);
    assert.equal((await api('DELETE', `/api/products/${id2}`, { token: seller.token })).status, 200);
    assert.ok(!fs.existsSync(path.join(srv.patternsDir, id2)));
  });
});

describe('pattern jobs without the tools', () => {
  let srv, seller;
  before(async () => {
    srv = await startTestServer();          // PATTERN_PYTHON указывает в никуда
    seller = await newUser('patnotools', { accountType: 'seller', storeName: 'No Tools' });
  });
  after(() => srv?.stop());

  it('fails with a clear message', async () => {
    const r = await api('POST', '/api/products', {
      token: seller.token,
      files: { image: ['dress.png', PNG] },
      fields: { title: 'Dress', price: '1', garmentType: 'top', silhouette: JSON.stringify({ template: 'top_loose' }), sizeChart: JSON.stringify(CHART) },
    });
    const p = await until(async () => {
      const x = (await api('GET', `/api/products/${r.json._id}`)).json;
      return x.patterns?.status === 'failed' ? x : null;
    });
    assert.equal(p.patterns.message, 'Pattern tools are not installed on this server.');
  });
});

describe('outcome', () => {
  it('some sizes failed — still ready, failures listed per size', () => {
    const o = outcome({ code: 0 }, {
      sizes: [{ size: 'S', within_1cm: false }],
      failed: [{ size: 'XXL', error: 'This size is outside the body range we can model yet.' }],
    });
    assert.equal(o.status, 'patterns_ready');
    assert.deepEqual(o.sizes, [
      { size: 'S', ok: true, within1cm: false },
      { size: 'XXL', ok: false, error: 'This size is outside the body range we can model yet.' },
    ]);
  });

  it('timeout and a job-level error', () => {
    assert.equal(outcome({ timedOut: true, code: null }, null).message, 'Drafting the patterns took too long.');
    assert.equal(outcome({ code: 0 }, { error: 'Patterns are built only for dresses, skirts and tops.' }).status, 'failed');
  });
});

describe('the figure of a size uses the same ease and stretch as the size advice', () => {
  it('scripts/garments/patterns_job.py matches client/src/utils/fitCalculator.js', () => {
    const root = path.resolve(SERVER_DIR, '..');
    const js = fs.readFileSync(path.join(root, 'client/src/utils/fitCalculator.js'), 'utf8');
    const py = fs.readFileSync(path.join(root, 'scripts/garments/patterns_job.py'), 'utf8');
    const ideal = Object.fromEntries([...js.matchAll(/^\s+(tight|regular|loose):\s+\{[^}]*ideal:\s*(-?\d+)/gm)].map((m) => [m[1], Number(m[2])]));
    const share = JSON.parse(/STRETCH_SHARE = (\{[^}]+\})/.exec(js)[1].replace(/(\w+):/g, '"$1":'));
    const pyIdeal = JSON.parse(/IDEAL_EASE = (\{[^}]+\})/.exec(py)[1]);
    const pyShare = JSON.parse(/STRETCH_SHARE = (\{[^}]+\})/.exec(py)[1]);
    assert.deepEqual(pyIdeal, ideal);
    assert.deepEqual(pyShare, share);
  });
});
