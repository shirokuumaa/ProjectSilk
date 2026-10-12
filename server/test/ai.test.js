// ИИ-прокси: только с токеном, лимит на пользователя, токен не уходит на GPU.
// В тестах лимит тяжёлых запросов — 3 в час (см. helpers.startTestServer).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, startFakeGpu, api, newUser, PNG } from './helpers.js';

const image = { image: ['x.png', PNG] };

describe('ai proxy', () => {
  let gpu, srv, alice, bob;

  before(async () => {
    gpu = await startFakeGpu();
    srv = await startTestServer({ gpuUrl: gpu.url });
    alice = await newUser('alice', { accountType: 'seller', storeName: 'Alice Shop' });
    bob = await newUser('bob');
  });
  after(async () => {
    await srv?.stop();
    await gpu?.close();
  });

  for (const [method, path] of [
    ['GET', '/api/ai/features'],
    ['GET', '/api/ai/__target'],
    ['POST', '/api/ai/remove-background'],
    ['POST', '/api/ai/triposr'],
  ]) {
    it(`${method} ${path} без токена → 401`, async () => {
      const r = await api(method, path, method === 'POST' ? { files: image } : {});
      assert.equal(r.status, 401);
    });
  }

  it('с токеном запрос доходит до GPU, а ответ GPU — до клиента', async () => {
    const r = await api('GET', '/api/ai/features', { token: alice.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.from, 'fake-gpu');
  });

  it('лимит тяжёлых запросов считается на пользователя', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await api('POST', '/api/ai/remove-background', { token: alice.token, files: image })).status, 200);
    }
    assert.equal((await api('POST', '/api/ai/remove-background', { token: alice.token, files: image })).status, 429);
    // у другого пользователя свой счётчик
    assert.equal((await api('POST', '/api/ai/remove-background', { token: bob.token, files: image })).status, 200);
    // лёгкие GET не входят в лимит тяжёлых
    assert.equal((await api('GET', '/api/ai/features', { token: alice.token })).status, 200);
  });

  it('Authorization и Cookie на GPU не уходят', () => {
    assert.ok(gpu.requests.length > 0);
    for (const req of gpu.requests) {
      assert.equal('authorization' in req.headers, false);
      assert.equal('cookie' in req.headers, false);
    }
  });
});
