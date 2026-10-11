// client/src/utils/auth.js
//
// Вход покупателя через сервер (JWT). Единственное место, которое знает,
// где лежит токен и как его отправлять.
//
//   authToken     — JWT, уходит в заголовке Authorization: Bearer
//   loggedInUser  — только имя для показа в интерфейсе, на сервере не используется
//
// Токен лежит в localStorage — это временно, см. отчёт по задаче:
// до публичного запуска перейти на httpOnly-cookie.

const API = process.env.REACT_APP_API || 'http://localhost:5050';

const TOKEN_KEY = 'authToken';
const NAME_KEY = 'loggedInUser';
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

function saveSession({ token, user }) {
  write(TOKEN_KEY, token);
  write(NAME_KEY, user?.username || null);
  notify();
}

export function logout() {
  write(TOKEN_KEY, null);
  write(NAME_KEY, null);
  // кэш обмеров принадлежит вышедшему пользователю — следующему не показываем
  write('bodyProfile', null);
  notify();
}

async function postCredentials(path, username, password) {
  let r;
  try {
    r = await fetch(`${API}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('Cannot reach the server. Please try again.');
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Request failed (HTTP ${r.status})`);

  saveSession(data);
  return data.user;
}

/** Регистрация; при успехе пользователь сразу вошёл. */
export function register(username, password) {
  return postCredentials('register', username, password);
}

export function login(username, password) {
  return postCredentials('login', username, password);
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
 * Вызывается один раз при запуске приложения:
 *   • удаляет старый localStorage 'user' с паролем;
 *   • убирает имя, оставшееся без токена (вход по старой схеме).
 */
export function cleanupLegacyAuth() {
  write(LEGACY_KEY, null);
  if (!getToken()) write(NAME_KEY, null);
}
