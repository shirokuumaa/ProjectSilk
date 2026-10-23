// Ошибки для пользователя: по-английски и без текста исключений
// (mongoose, body-parser, multer) — он остаётся только в логе сервера.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, newUser, BASE, SERVER_DIR, PNG } from './helpers.js';

const CYRILLIC = /[Ѐ-ӿ]/;
const M = { heightCm: 166, chest: 92, waist: 74, hips: 99 };

/** Ответ без следов исключения: нет поля error/details/stack и внутренних фраз. */
function assertClean(r) {
  assert.ok(r.json, `ответ не JSON: ${r.text}`);
  assert.equal(r.json.error, undefined);
  assert.equal(r.json.details, undefined);
  assert.equal(r.json.stack, undefined);
  assert.doesNotMatch(r.text, CYRILLIC);
  assert.doesNotMatch(r.text, /Unexpected token|is not valid JSON|Path `|Cast to|ValidationError|MulterError|at .+\.js:\d+/);
}

describe('error messages for the user', () => {
  let srv, user, seller;

  before(async () => {
    srv = await startTestServer();
    user = await newUser('erruser');
    seller = await newUser('errseller', { accountType: 'seller', storeName: 'Err Store' });
  });
  after(() => srv?.stop());

  it('битый JSON → 400 «Invalid request.» без текста парсера', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username": ',
    });
    const r = { status: res.status, text: await res.text() };
    r.json = JSON.parse(r.text);
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Invalid request.');
    assertClean(r);
  });

  it('обмеры не заполнены → английское сообщение и список полей', async () => {
    const r = await api('POST', '/api/body-profile', { token: user.token, body: { heightCm: 166 } });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /^Please fill in all required measurements: chest, waist, hips\.$/);
    assert.deepEqual(r.json.fields, ['chest', 'waist', 'hips']);
    assertClean(r);
  });

  it('обмеры вне диапазона → названия полей, без текста mongoose', async () => {
    const r = await api('POST', '/api/body-profile', { token: user.token, body: { ...M, chest: 20 } });
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'Some measurements are out of range: chest.');
    assert.deepEqual(r.json.fields, ['chest']);
    assertClean(r);
  });

  it('загрузка: лишнее поле файла → наше сообщение, не текст multer', async () => {
    const r = await api('POST', '/api/products', {
      token: seller.token,
      fields: { title: 'Tee', price: '10' },
      files: { image: ['a.png', PNG], extra: ['b.png', PNG] },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /^Unexpected file field/);
    assertClean(r);
  });

  it('регистрация: все ошибки формы сразу — списком errors и одной строкой message', async () => {
    const r = await api('POST', '/api/auth/register', {
      body: { username: 'ab', password: 'short', accountType: 'seller', storeName: '' },
    });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.errors, [
      'Store name must be 2–60 characters.',
      'Username must be 3–32 characters: letters, digits, dot, dash or underscore.',
      'Password must be at least 8 characters.',
    ]);
    assert.equal(r.json.message, r.json.errors.join(' '));
    assertClean(r);
  });

  it('в коде ответов нет e.message / String(err) — текст исключений не уходит наружу', () => {
    const files = [
      'index.js',
      ...['routes', 'controllers', 'middleware'].flatMap((d) =>
        fs.readdirSync(path.join(SERVER_DIR, d)).map((f) => path.join(d, f))),
    ].filter((f) => /\.(m?js)$/.test(f));

    const leaks = [];
    for (const f of files) {
      fs.readFileSync(path.join(SERVER_DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\.json\(/.test(line) && /\b(e|err|error)\??\.(message|stack)\b|String\((e|err|error)\b/.test(line)) {
          leaks.push(`${f}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(leaks, []);
  });
});
