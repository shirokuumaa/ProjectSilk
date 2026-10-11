// server/routes/wardrobeRoutes.js
import express from 'express';
import { listWardrobe, addWardrobeItem, removeWardrobeItem, clearWardrobe } from '../controllers/wardrobeController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();
/**
 * Монтировать как: app.use('/api/wardrobe', wardrobeRoutes)
 * Нужен токен (Authorization: Bearer). Пользователь — из токена.
 */
router.use(requireAuth);

router.get('/', listWardrobe);
router.post('/', addWardrobeItem);
router.delete('/', clearWardrobe);            // очистить всё
router.delete('/:productId', removeWardrobeItem);

export default router;