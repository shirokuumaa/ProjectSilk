// server/routes/bodyProfileRoutes.js
//
// Все маршруты требуют токен. Пользователь берётся из токена (req.user);
// имя в URL или теле оставлено для совместимости — если оно чужое, 403.
import express from 'express';
import BodyProfile from '../models/BodyProfile.js';
import { requireAuth, isOtherUser } from '../middleware/requireAuth.js';

const router = express.Router();

router.use(requireAuth);

const FORBIDDEN = { message: 'You can only access your own body profile' };

async function sendProfile(req, res) {
  try {
    const profile = await BodyProfile.findOne({ user: req.user.username });
    if (!profile) return res.json(null);

    res.json({
      ...profile.toObject(),
      morphTargets: profile.toMorphTargets(),
    });
  } catch (err) {
    console.error('bodyProfile GET error:', err);
    res.status(500).json({ message: 'Не удалось загрузить профиль тела' });
  }
}

async function deleteProfile(req, res) {
  try {
    await BodyProfile.deleteOne({ user: req.user.username });
    res.json({ ok: true });
  } catch (err) {
    console.error('bodyProfile DELETE error:', err);
    res.status(500).json({ message: 'Не удалось удалить профиль тела' });
  }
}

/**
 * GET /api/body-profile/me
 * GET /api/body-profile/:user   (только свой)
 * Вернуть профиль тела покупателя (или null, если ещё не заполнен).
 */
router.get('/me', sendProfile);
router.get('/:user', (req, res) => {
  if (isOtherUser(req, req.params.user)) return res.status(403).json(FORBIDDEN);
  return sendProfile(req, res);
});

/**
 * POST /api/body-profile
 * Создать или обновить свой профиль. Тело запроса: { heightCm, chest, ... }
 */
router.post('/', async (req, res) => {
  try {
    const { user: claimed, ...data } = req.body || {};
    if (isOtherUser(req, claimed)) return res.status(403).json(FORBIDDEN);

    const user = req.user.username;

    const required = ['heightCm', 'chest', 'waist', 'hips'];
    const missing = required.filter((key) => data[key] == null);
    if (missing.length) {
      return res.status(400).json({
        message: `Не заполнены обязательные обмеры: ${missing.join(', ')}`,
      });
    }

    const profile = await BodyProfile.findOneAndUpdate(
      { user },
      { $set: { ...data, user } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({
      ...profile.toObject(),
      morphTargets: profile.toMorphTargets(),
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Некорректные обмеры',
        details: Object.values(err.errors).map((e) => e.message),
      });
    }
    console.error('bodyProfile POST error:', err);
    res.status(500).json({ message: 'Не удалось сохранить профиль тела' });
  }
});

/**
 * DELETE /api/body-profile/me
 * DELETE /api/body-profile/:user   (только свой)
 */
router.delete('/me', deleteProfile);
router.delete('/:user', (req, res) => {
  if (isOtherUser(req, req.params.user)) return res.status(403).json(FORBIDDEN);
  return deleteProfile(req, res);
});

export default router;
