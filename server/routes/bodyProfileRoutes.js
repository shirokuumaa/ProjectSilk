// server/routes/bodyProfileRoutes.js
import express from 'express';
import BodyProfile from '../models/BodyProfile.js';

const router = express.Router();

/**
 * GET /api/body-profile/:user
 * Вернуть профиль тела покупателя (или null, если ещё не заполнен).
 */
router.get('/:user', async (req, res) => {
  try {
    const profile = await BodyProfile.findOne({ user: req.params.user });
    if (!profile) return res.json(null);

    res.json({
      ...profile.toObject(),
      morphTargets: profile.toMorphTargets(),
    });
  } catch (err) {
    console.error('bodyProfile GET error:', err);
    res.status(500).json({ message: 'Не удалось загрузить профиль тела' });
  }
});

/**
 * POST /api/body-profile
 * Создать или обновить профиль. Тело запроса: { user, heightCm, chest, ... }
 */
router.post('/', async (req, res) => {
  try {
    const { user, ...data } = req.body || {};

    if (!user) {
      return res.status(400).json({ message: 'Не указан пользователь' });
    }

    const required = ['heightCm', 'chest', 'waist', 'hips'];
    const missing = required.filter((key) => data[key] == null);
    if (missing.length) {
      return res.status(400).json({
        message: `Не заполнены обязательные обмеры: ${missing.join(', ')}`,
      });
    }

    const profile = await BodyProfile.findOneAndUpdate(
      { user },
      { $set: { user, ...data } },
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
 * DELETE /api/body-profile/:user
 */
router.delete('/:user', async (req, res) => {
  try {
    await BodyProfile.deleteOne({ user: req.params.user });
    res.json({ ok: true });
  } catch (err) {
    console.error('bodyProfile DELETE error:', err);
    res.status(500).json({ message: 'Не удалось удалить профиль тела' });
  }
});

export default router;
