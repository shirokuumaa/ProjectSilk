// client/src/utils/auth.js
//
// Вход покупателя через сервер (JWT). Единственное место, которое знает,
// где лежит токен и как его отправлять.
//
//   authToken     — JWT, уходит в заголовке Authorization: Bearer
//   loggedInUser  — только имя для показа в интерфейсе, на сервере не используется
//   userRole, storeName — тоже только для показа; права проверяет сервер
//
// Токен лежит в localStorage — это временно, см. отчёт по задаче:
// до публичного запуска перейти на httpOnly-cookie.

const API = process.env.REACT_APP_API || 'http://localhost:5050';

const TOKEN_KEY = 'authToken';
const NAME_KEY = 'loggedInUser';
const ROLE_KEY = 'userRole';
const STORE_KEY = 'storeName';
const LEGACY_KEY = 'user'; // старая «регистрация»: { username, password } открытым текстом

/** Событие на window: вход, выход или токен перестал работать. */
export const AUTH_EVENT = 'auth-changed';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* приватный режим / квота */ }
}

function notify() {
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function getToken() {
  return read(TOKEN_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

/** Имя для показа. Без токена — null, даже если имя где-то осталось. */
export function getUsername() {
  return isLoggedIn() ? read(NAME_KEY) : null;
}

/** 'buyer' | 'seller' | null — последняя известная роль (для интерфейса). */
export function getRole() {
  return isLoggedIn() ? read(ROLE_KEY) : null;
}

export function getStoreName() {
  return isLoggedIn() ? read(STORE_KEY) : null;
}

export function isSeller() {
  return getRole() === 'seller';
}

function saveUser(user) {
  write(NAME_KEY, user?.username || null);
  write(ROLE_KEY, user?.role || null);
  write(STORE_KEY, user?.storeName || null);
}

function saveSession({ token, user }) {
  write(TOKEN_KEY, token);
  saveUser(user);
  notify();
}

export function logout() {
  write(TOKEN_KEY, null);
  write(NAME_KEY, null);
  write(ROLE_KEY, null);
  write(STORE_KEY, null);
  // кэш обмеров принадлежит вышедшему пользователю — следующему не показываем
  write('bodyProfile', null);
  notify();
}

async function postCredentials(path, body) {
  let r;
  try {
    r = await fetch(`${API}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the server. Please try again.');
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Request failed (HTTP ${r.status})`);

  saveSession(data);
  return data.user;
}

/**
 * Регистрация; при успехе пользователь сразу вошёл.
 * accountType: 'buyer' | 'seller'; для продавца нужен storeName.
 */
export function register(username, password, { accountType = 'buyer', storeName } = {}) {
  return postCredentials('register', { username, password, accountType, storeName });
}

export function login(username, password) {
  return postCredentials('login', { username, password });
}

/**
 * fetch с токеном. На 401 (токен истёк или аккаунт удалён) выходим,
 * чтобы интерфейс не показывал имя, под которым ничего не работает.
 */
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const r = await fetch(url, { ...options, headers });
  if (r.status === 401 && token) logout();
  return r;
}

/**
 * Актуальный пользователь с сервера (роль могла поменяться).
 * @returns {Promise<object|null>} null — не вошёл или токен недействителен
 */
export async function fetchMe() {
  if (!isLoggedIn()) return null;
  const r = await authFetch(`${API}/api/auth/me`);
  if (!r.ok) return null;
  const user = await r.json();
  saveUser(user);
  notify();
  return user;
}

/** Покупатель открывает магазин. Токен остаётся прежним. */
export async function becomeSeller(storeName) {
  const r = await authFetch(`${API}/api/auth/become-seller`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeName }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Request failed (HTTP ${r.status})`);
  saveUser(data.user);
  notify();
  return data.user;
}

/**
 * Вызывается один раз при запуске приложения:
 *   • удаляет старый localStorage 'user' с паролем;
 *   • убирает имя, оставшееся без токена (вход по старой схеме).
 */
export function cleanupLegacyAuth() {
  write(LEGACY_KEY, null);
  if (!getToken()) {
    write(NAME_KEY, null);
    write(ROLE_KEY, null);
    write(STORE_KEY, null);
  }
}
