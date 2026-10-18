// Вход в httpOnly-cookie: сервер ставит её при входе, принимает вместо Bearer,
// стирает при выходе; запросы с cookie с чужого сайта не меняют данные.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, newUser, BASE } from './helpers.js';

const CLIENT = 'http://localhost:3011'; // CORS_ORIGINS тестового сервера
const M = { heightCm: 165, chest: 88, waist: 68, hips: 94 };

const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0]; // "ps_token=..."

async function loginRaw(username) {
  return fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CLIENT },
    body: JSON.stringify({ username, password: 'test-pass-123' }),
  });
}

describe('вход в httpOnly-cookie', () => {
  let srv, cookieA, cookieB;

  before(async () => {
    srv = await startTestServer();
    await newUser('cookiealice');
    await newUser('cookiebob');
  });
  after(() => srv?.stop());

  it('вход ставит httpOnly-cookie с SameSite=Lax', async () => {
    const r = await loginRaw('cookiealice');
    assert.equal(r.status, 200);
    const raw = r.headers.get('set-cookie') || '';
    assert.match(raw, /^ps_token=[\w-]+\.[\w-]+\.[\w-]+;/);
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=Lax/i);
    assert.match(raw, /Path=\//i);
    cookieA = cookieOf(r);
    cookieB = cookieOf(await loginRaw('cookiebob'));
  });

  it('регистрация тоже ставит cookie', async () => {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cookiecarol', password: 'test-pass-123' }),
    });
    assert.equal(r.status, 201);
    assert.match(r.headers.get('set-cookie') || '', /^ps_token=.+HttpOnly/i);
  });

  it('с cookie без заголовка Authorization запросы работают', async () => {
    const me = await api('GET', '/api/auth/me', { headers: { Cookie: cookieA } });
    assert.equal(me.status, 200);
    assert.equal(me.json.username, 'cookiealice');

    const saved = await api('POST', '/api/body-profile', { headers: { Cookie: cookieA, Origin: CLIENT }, body: M });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.user, 'cookiealice');
  });

  it('cookie Боба не открывает данные Алисы', async () => {
    assert.equal((await api('GET', '/api/body-profile/me', { headers: { Cookie: cookieB } })).json, null);
    assert.equal((await api('GET', '/api/body-profile/cookiealice', { headers: { Cookie: cookieB } })).status, 403);
  });

  it('изменение с cookie с чужого сайта → 403, данные не меняются', async () => {
    const r = await api('POST', '/api/body-profile', {
      headers: { Cookie: cookieA, Origin: 'http://evil.example' }, body: { ...M, chest: 120 },
    });
    assert.equal(r.status, 403);
    const me = await api('GET', '/api/body-profile/me', { headers: { Cookie: cookieA } });
    assert.equal(me.json.chest, 88);
  });

  it('без cookie и без токена → 401', async () => {
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    assert.equal((await api('GET', '/api/auth/me', { headers: { Cookie: 'ps_token=garbage' } })).status, 401);
  });

  it('выход стирает cookie', async () => {
    const r = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookieA, Origin: CLIENT } });
    assert.equal(r.status, 200);
    const raw = r.headers.get('set-cookie') || '';
    assert.match(raw, /^ps_token=;/);
    assert.match(raw, /Expires=Thu, 01 Jan 1970/i);
  });

  it('CORS разрешает браузеру отправлять cookie только со своего адреса', async () => {
    const pre = (origin) => fetch(`${BASE}/api/wardrobe`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    const ok = await pre(CLIENT);
    assert.equal(ok.headers.get('access-control-allow-origin'), CLIENT);
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    const evil = await pre('http://evil.example');
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});
