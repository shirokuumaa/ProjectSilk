// Вход в httpOnly-cookie: токен не попадает в localStorage, запросы идут с cookie,
// выход просит сервер стереть cookie, старый токен из localStorage удаляется.
import {
  login, logout, authFetch, isLoggedIn, getUsername, cleanupLegacyAuth,
} from './auth';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

test('login keeps only the name and role; the token is not stored anywhere in the browser', async () => {
  global.fetch.mockResolvedValue(ok({ token: 'header.payload.signature', user: { username: 'alice', role: 'buyer' } }));
  await login('alice', 'secret-password');

  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/auth\/login$/);
  expect(options.credentials).toBe('include'); // иначе браузер не примет cookie
  expect(isLoggedIn()).toBe(true);
  expect(getUsername()).toBe('alice');
  const everything = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join(' ');
  expect(everything).not.toContain('header.payload.signature');
});

test('authFetch sends the cookie and no Authorization header', async () => {
  localStorage.setItem('loggedInUser', 'alice');
  global.fetch.mockResolvedValue(ok({}));
  await authFetch('http://api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const [, options] = global.fetch.mock.calls[0];
  expect(options.credentials).toBe('include');
  expect(new Headers(options.headers).get('Authorization')).toBeNull();
  expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
});

test('a 401 (cookie expired) logs the user out in the browser', async () => {
  localStorage.setItem('loggedInUser', 'alice');
  localStorage.setItem('wardrobeItems', '[{"id":"p1"}]');
  global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  await authFetch('http://api/x');
  expect(isLoggedIn()).toBe(false);
  expect(localStorage.getItem('wardrobeItems')).toBeNull();
});

test('logout asks the server to clear the cookie', async () => {
  localStorage.setItem('loggedInUser', 'alice');
  global.fetch.mockResolvedValue(ok({ ok: true }));
  await logout();
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/auth\/logout$/);
  expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
  expect(isLoggedIn()).toBe(false);
});

test('logout still clears the browser when the server is down', async () => {
  localStorage.setItem('loggedInUser', 'alice');
  localStorage.setItem('bodyProfile', '{"chest":88}');
  global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(logout()).resolves.toBeUndefined();
  expect(isLoggedIn()).toBe(false);
  expect(localStorage.getItem('bodyProfile')).toBeNull();
});

test('an old token in localStorage is removed and the user has to sign in again', () => {
  localStorage.setItem('authToken', 'old.jwt.token');
  localStorage.setItem('loggedInUser', 'alice');
  localStorage.setItem('wardrobeItems', '[{"id":"p1"}]');
  global.fetch.mockResolvedValue(ok({}));
  cleanupLegacyAuth();
  expect(localStorage.getItem('authToken')).toBeNull();
  expect(isLoggedIn()).toBe(false);
  expect(localStorage.getItem('wardrobeItems')).toBeNull();
});
