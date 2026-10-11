// server/controllers/wardrobeController.js
import WardrobeItem from '../models/WardrobeItem.js';
import { isOtherUser } from '../middleware/requireAuth.js';

/**
 * Пользователь — только из токена (req.user, см. requireAuth).
 * ?user= и x-user оставлены для совместимости: если там чужое имя — 403.
 */
function pickUser(req, res) {
  const claimed = req.query.user ?? req.headers['x-user'];
  if (isOtherUser(req, claimed)) {
    res.status(403).json({ message: 'You can only access your own wardrobe' });
    return null;
  }
  return req.user.username;
}

export async function listWardrobe(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    const items = await WardrobeItem.find({ user }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'list error', error: String(e?.message || e) });
  }
}

export async function addWardrobeItem(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    const { productId, name, price = 0, image, category = 'Clothes' } = req.body || {};
    if (!productId || !name || !image) {
      return res.status(400).json({ message: 'productId, name, image are required' });
    }
    const doc = await WardrobeItem.findOneAndUpdate(
      { user, productId },
      { user, productId, name, price: Number(price) || 0, image, category },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ message: 'add error', error: String(e?.message || e) });
  }
}

export async function removeWardrobeItem(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    const { productId } = req.params;
    await WardrobeItem.deleteOne({ user, productId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'remove error', error: String(e?.message || e) });
  }
}

export async function clearWardrobe(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    await WardrobeItem.deleteMany({ user });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'clear error', error: String(e?.message || e) });
  }
}