// server/routes/wardrobeRoutes.js
import express from 'express';
import { listWardrobe, addWardrobeItem, removeWardrobeItem, clearWardrobe } from '../controllers/wardrobeController.js';

const router = express.Router();
/**
 * Монтировать как: app.use('/api/wardrobe', wardrobeRoutes)
 * user прокидываем в ?user=... (или заголовок x-user)
 */
router.get('/', listWardrobe);
router.post('/', addWardrobeItem);
router.delete('/', clearWardrobe);            // очистить всё
router.delete('/:productId', removeWardrobeItem);

export default router;