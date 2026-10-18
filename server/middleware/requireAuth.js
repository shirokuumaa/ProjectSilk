// server/middleware/requireAuth.js
//
// Проверка JWT. Браузер присылает его в httpOnly-cookie (JS страницы токен не видит),
// другие клиенты и тесты — в заголовке Authorization: Bearer <token>.
// Пользователь кладётся в req.user = { id, username } и дальше берётся
// только оттуда — не из URL и не из тела запроса.

import jwt from 'jsonwebtoken';
import User, { normalizeUsername } from '../models/User.js';
import { allowedOrigins } from '../config/cors.js';

const TOKEN_TTL = '7d';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const AUTH_COOKIE = 'ps_token';

/**
 * httpOnly — недоступна JS страницы; SameSite=Lax — чужой сайт не отправит её
 * формой или fetch'ем; Secure — в продакшне (или COOKIE_SECURE=1), на http://localhost нельзя.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1',
    path: '/',
  };
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_TTL_MS });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Токен из заголовка или cookie; fromCookie — чтобы проверить, откуда пришёл запрос. */
function readToken(req) {
  const header = String(req.headers.authorization || '');
  if (header) {
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? { token } : {};
  }
  const token = readCookie(req, AUTH_COOKIE);
  return token ? { token, fromCookie: true } : {};
}

// Читаем при каждом вызове, а не при импорте: dotenv.config() в index.js
// срабатывает уже после того, как ES-модули загружены.
export function getJwtSecret() {
  return process.env.JWT_SECRET || '';
}

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), username: user.username },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: TOKEN_TTL },
  );
}

export async function requireAuth(req, res, next) {
  const { token, fromCookie } = readToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  // cookie браузер приложит к любому запросу на этот адрес; изменения принимаем
  // только со своих страниц (вторая линия защиты после SameSite=Lax)
  const origin = req.headers.origin;
  if (fromCookie && !SAFE_METHODS.has(req.method) && origin && !allowedOrigins().includes(origin)) {
    return res.status(403).json({ message: 'Request from an unknown site' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ message: 'Account no longer exists' });
    // роль читаем из базы на каждом запросе: «Become a seller» действует сразу
    req.user = publicUser(user);
    next();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    next(err);
  }
}

/** То, что о пользователе можно отдавать клиенту и класть в req.user. */
export function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    role: user.role || 'buyer', // записи до появления ролей — покупатели
    storeName: user.storeName || null,
  };
}

/** Только для указанной роли; ставится после requireAuth. */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({
        message: role === 'seller'
          ? 'This action requires a seller account.'
          : 'You do not have access to this action.',
      });
    }
    next();
  };
}

/**
 * Запрос явно называет другого пользователя (в URL, ?user=, заголовке или теле)?
 * Пустое значение — не чужое: тогда просто используется req.user.
 */
export function isOtherUser(req, claimed) {
  if (claimed == null || String(claimed).trim() === '') return false;
  return normalizeUsername(claimed) !== req.user.username;
}
