// Запуск сервера: лимит попыток входа, обязательный JWT_SECRET, занятый порт.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, spawnServer, api, newUser, TEST_PORT, TEST_MONGO_URI,
} from './helpers.js';

describe('login rate limit', () => {
  let srv;

  before(async () => {
    srv = await startTestServer(); // свежий процесс — счётчики попыток пустые
    await newUser('alice');
  });
  after(() => srv?.stop());

  it('после 10 неудачных попыток — 429, даже с верным паролем', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await api('POST', '/api/auth/login', { body: { username: 'alice', password: `wrong-${i}` } });
      assert.equal(r.status, 401);
    }
    assert.equal((await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong-11' } })).status, 429);
    assert.equal((await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'test-pass-123' } })).status, 429);
  });

  it('занятый порт: второй сервер завершается с кодом 1 и понятной ошибкой', async () => {
    const proc = spawnServer({ PORT: String(TEST_PORT), MONGODB_URI: TEST_MONGO_URI, JWT_SECRET: 'x'.repeat(40) });
    const code = await proc.exited;
    assert.equal(code, 1);
    assert.match(proc.output(), new RegExp(`Порт ${TEST_PORT} уже занят`));
  });
});

describe('JWT_SECRET', () => {
  for (const [name, secret] of [['пустой', ''], ['короче 32 символов', 'short']]) {
    it(`${name} — сервер не стартует`, async () => {
      const proc = spawnServer({ PORT: String(TEST_PORT + 1), MONGODB_URI: TEST_MONGO_URI, JWT_SECRET: secret });
      assert.equal(await proc.exited, 1);
      assert.match(proc.output(), /JWT_SECRET/);
    });
  }
});
