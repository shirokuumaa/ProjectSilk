// client/src/utils/auth.js
//
// Вход покупателя через сервер (JWT). Единственное место, которое знает,
// как отправлять запросы от имени вошедшего.
//
// Токен живёт в httpOnly-cookie, которую ставит сервер: JS страницы его не видит,
// и украсть его через внедрённый скрипт нельзя. Браузер прикладывает cookie сам,
// если запрос идёт с credentials: 'include' (authFetch).
//
//   loggedInUser  — имя для показа и признак «вошёл»; права проверяет сервер
//   userRole, storeName — тоже только для показа

const API = process.env.REACT_APP_API || 'http://localhost:5050';

const TOKEN_KEY = 'authToken'; // старое хранение токена в localStorage — только чтобы стереть
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
  'cartItems',          // корзина
  'favorites',          // избранное
];
/** Что гость приносит с собой при входе: это его же данные, а не чужой аккаунт. */
const GUEST_KEEPS = new Set(['avatarDraft', 'cartItems', 'favorites']);
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

/** Вошёл ли пользователь (по данным браузера; если cookie истекла — первый же 401 выйдет). */
export function isLoggedIn() {
  return !!read(NAME_KEY);
}

/** Имя для показа. */
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

function saveSession({ user }) {
  // token из ответа не сохраняем: вход держит httpOnly-cookie
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
  // черновик обмеров, корзина и избранное гостя остаются: это его же данные
  ACCOUNT_KEYS.filter((k) => !GUEST_KEEPS.has(k)).forEach((k) => write(k, null));
  write(GUEST_WARDROBE_KEY, guest.length ? JSON.stringify(guest) : null);
}

function forgetUser() {
  write(TOKEN_KEY, null);
  write(NAME_KEY, null);
  write(ROLE_KEY, null);
  write(STORE_KEY, null);
  // гардероб, обмеры и черновики принадлежат вышедшему пользователю
  clearAccountData();
  notify();
}

/**
 * Выход: данные в браузере стираются сразу, cookie — запросом к серверу.
 * Перед перезагрузкой страницы дождитесь промиса.
 */
export function logout() {
  forgetUser();
  return Promise.resolve()
    .then(() => fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', keepalive: true }))
    .then(() => undefined)
    .catch(() => undefined); // сервер недоступен — cookie истечёт сама
}

async function postCredentials(path, body) {
  let r;
  try {
    r = await fetch(`${API}/api/auth/${path}`, {
      method: 'POST',
      credentials: 'include', // без этого браузер не примет cookie с другого порта
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the server. Please try again.');
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // errors — все ошибки формы сразу (регистрация), message — их общий текст
    throw Object.assign(new Error(data.message || `Request failed (HTTP ${r.status})`), {
      errors: Array.isArray(data.errors) ? data.errors : undefined,
    });
  }

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
 * fetch от имени вошедшего: браузер прикладывает cookie входа.
 * На 401 (cookie истекла или аккаунт удалён) выходим,
 * чтобы интерфейс не показывал имя, под которым ничего не работает.
 */
export async function authFetch(url, options = {}) {
  const wasLoggedIn = isLoggedIn();
  const r = await fetch(url, { ...options, credentials: 'include' });
  if (r.status === 401 && wasLoggedIn) logout();
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
 *   • токен в localStorage (вход до перехода на cookie) стирает вместе с данными
 *     пользователя: cookie у него ещё нет, нужно войти заново.
 */
export function cleanupLegacyAuth() {
  write(LEGACY_KEY, null);
  if (read(TOKEN_KEY)) {
    forgetUser();
    return;
  }
  if (!read(NAME_KEY)) {
    write(ROLE_KEY, null);
    write(STORE_KEY, null);
  }
}
