// Внутренний адрес видеокарты не уходит клиенту: ни в служебных ответах ИИ,
// ни в ошибках прокси, ни в ответе сохранения аватара.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, startFakeGpu, api, newUser } from './helpers.js';

const noGpu = (r, gpuUrl) => {
  const host = new URL(gpuUrl).host;
  assert.equal(r.text.includes(host), false, `в ответе есть адрес видеокарты: ${r.text}`);
  assert.equal(/GPU_URL|sourceUrl/.test(r.text), false, `в ответе служебное поле: ${r.text}`);
};

describe('адрес видеокарты: видеокарта отвечает', () => {
  let gpu, srv, user;

  before(async () => {
    gpu = await startFakeGpu();
    srv = await startTestServer({ gpuUrl: gpu.url });
    user = await newUser('gpuuser');
  });
  after(async () => {
    await srv?.stop();
    await gpu?.close();
  });

  for (const path of ['/api/ai/__target', '/api/ai/__config']) {
    it(`${path}: только режим и включён ли ИИ`, async () => {
      const r = await api('GET', path, { token: user.token });
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ['AI_ENABLED', 'AI_MODE']);
      noGpu(r, gpu.url);
    });
  }

  it('сохранение аватара не возвращает адрес источника', async () => {
    const r = await api('POST', '/api/avatar/persist', { token: user.token, body: { url: '/static/mesh/a.obj' } });
    assert.equal(r.status, 200);
    assert.match(r.json.localUrl, /^\/uploads\/avatars\//);
    noGpu(r, gpu.url);
  });

  it('файл с чужого адреса: отказ без упоминания адреса видеокарты', async () => {
    const r = await api('POST', '/api/avatar/persist', { token: user.token, body: { url: 'http://evil.example/a.obj' } });
    assert.equal(r.status, 400);
    noGpu(r, gpu.url);
  });
});

describe('адрес видеокарты: видеокарта не отвечает', () => {
  const deadGpu = 'http://127.0.0.1:9'; // порт discard — соединение отклоняется
  let srv, user;

  before(async () => {
    srv = await startTestServer({ gpuUrl: deadGpu });
    user = await newUser('gpuuser2');
  });
  after(() => srv?.stop());

  it('502 от прокси — без адреса и текста ошибки', async () => {
    const r = await api('GET', '/api/ai/features', { token: user.token });
    assert.equal(r.status, 502);
    assert.equal(r.json.message, 'The AI service is not responding. Please try again later.');
    noGpu(r, deadGpu);
  });

  it('сохранение аватара при недоступной видеокарте — без адреса', async () => {
    const r = await api('POST', '/api/avatar/persist', { token: user.token, body: { url: '/static/mesh/a.obj' } });
    assert.equal(r.status, 500);
    noGpu(r, deadGpu);
  });
});
