// server/middleware/requireAuth.js
//
// Проверка JWT из заголовка Authorization: Bearer <token>.
// Пользователь кладётся в req.user = { id, username } и дальше берётся
// только оттуда — не из URL и не из тела запроса.

import jwt from 'jsonwebtoken';
import User, { normalizeUsername } from '../models/User.js';

const TOKEN_TTL = '7d';

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
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication required' });
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
    req.user = { id: String(user._id), username: user.username };
    next();
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    next(err);
  }
}

/**
 * Запрос явно называет другого пользователя (в URL, ?user=, заголовке или теле)?
 * Пустое значение — не чужое: тогда просто используется req.user.
 */
export function isOtherUser(req, claimed) {
  if (claimed == null || String(claimed).trim() === '') return false;
  return normalizeUsername(claimed) !== req.user.username;
}
