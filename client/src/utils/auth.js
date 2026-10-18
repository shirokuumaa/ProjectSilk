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

// Данные покупателя в браузере: при выходе удаляются, следующему не показываем.
// Источник правды для вошедшего — сервер (гардероб, обмеры), здесь только кэш и черновики.
export const ACCOUNT_KEYS = [
  'bodyProfile',        // кэш обмеров с сервера
  'wardrobeItems',      // кэш гардероба
  'wardrobeOutfits',    // сохранённые образы
  'avatarDraft',        // черновик создания аватара: обмеры и фото
  'avatarOutfitDraft',  // что надето в примерке
  'avatarChosenSizes',  // выбранные в примерке размеры
  'avatarFinal',        // результат тестовой страницы аватара
];
/** Гардероб гостя, отложенный при входе, пока он не решил — перенести или выбросить. */
export const GUEST_WARDROBE_KEY = 'guestWardrobe';

/** Событие на window: вход, выход или токен перестал работать. */
export const AUTH_EVENT = 'auth-changed';
/** Событие на window: пользователь только что вошёл или зарегистрировался. */
export const LOGIN_EVENT = 'auth-login';

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

function clearAccountData() {
  ACCOUNT_KEYS.forEach((k) => write(k, null));
  write(GUEST_WARDROBE_KEY, null);
}

/**
 * Перед входом: данные прошлого пользователя убираем, а гардероб гостя
 * откладываем — после входа ему предложат перенести вещи в аккаунт.
 */
function prepareForLogin() {
  if (isLoggedIn()) {
    clearAccountData();
    return;
  }
  let guest = [];
  try {
    const items = JSON.parse(read('wardrobeItems') || '[]');
    const stashed = JSON.parse(read(GUEST_WARDROBE_KEY) || '[]');
    guest = [...(Array.isArray(stashed) ? stashed : []), ...(Array.isArray(items) ? items : [])];
  } catch { /* битый JSON — гостевой гардероб не спасти */ }
  const seen = new Set();
  guest = guest.filter((x) => {
    const id = String(x?.id || x?._id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // черновик обмеров гостя остаётся: это его же форма, сохранит — уйдёт в аккаунт
  ACCOUNT_KEYS.filter((k) => k !== 'avatarDraft').forEach((k) => write(k, null));
  write(GUEST_WARDROBE_KEY, guest.length ? JSON.stringify(guest) : null);
}

export function logout() {
  write(TOKEN_KEY, null);
  write(NAME_KEY, null);
  write(ROLE_KEY, null);
  write(STORE_KEY, null);
  // гардероб, обмеры и черновики принадлежат вышедшему пользователю
  clearAccountData();
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

  prepareForLogin();
  saveSession(data);
  window.dispatchEvent(new Event(LOGIN_EVENT));
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
