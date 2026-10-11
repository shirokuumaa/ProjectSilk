// server/routes/authRoutes.js
//
//   POST /api/auth/register  { username, password } → 201 { token, user }
//   POST /api/auth/login     { username, password } → 200 { token, user }
//   GET  /api/auth/me        (Bearer)               → 200 { id, username }
//
// Сообщения об ошибках видит покупатель — поэтому они на английском.

import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User, { USERNAME_RE, normalizeUsername } from '../models/User.js';
import { requireAuth, signToken } from '../middleware/requireAuth.js';

const router = express.Router();

const BCRYPT_COST = 12;
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt молча отбрасывает всё, что длиннее

// Счётчики в памяти процесса: для одного сервера достаточно,
// после перезапуска обнуляются.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // считаем только неудачные попытки
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many sign-ups from this address. Please try again later.' },
});

// Хеш-пустышка: для несуществующего имени тоже гоняем bcrypt,
// чтобы по времени ответа нельзя было понять, есть ли такой пользователь.
let dummyHash = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await bcrypt.hash('not-a-real-password', BCRYPT_COST);
  return dummyHash;
}

const publicUser = (u) => ({ id: String(u._id), username: u.username });

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? '');

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        message: 'Username must be 3–32 characters: letters, digits, dot, dash or underscore.',
      });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      return res.status(400).json({ message: 'Password is too long (maximum 72 characters).' });
    }

    if (await User.exists({ username })) {
      return res.status(409).json({ message: 'This username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    let user;
    try {
      user = await User.create({ username, passwordHash });
    } catch (err) {
      // два одновременных запроса с одним именем
      if (err?.code === 11000) {
        return res.status(409).json({ message: 'This username is already taken.' });
      }
      throw err;
    }

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? '');

    const user = await User.findOne({ username }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user?.passwordHash || await getDummyHash());

    if (!user || !ok) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
