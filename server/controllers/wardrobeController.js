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
    console.error('wardrobe list error:', e);
    res.status(500).json({ message: 'Could not load the wardrobe.' });
  }
}

export async function addWardrobeItem(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    const { productId, name, price = 0, image = '', category = 'Clothes' } = req.body || {};
    if (!productId || !name) {
      return res.status(400).json({ message: 'productId and name are required' });
    }
    const doc = await WardrobeItem.findOneAndUpdate(
      { user, productId },
      { user, productId, name, price: Number(price) || 0, image, category },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    res.status(201).json(doc);
  } catch (e) {
    console.error('wardrobe add error:', e);
    res.status(500).json({ message: 'Could not save the item.' });
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
    console.error('wardrobe remove error:', e);
    res.status(500).json({ message: 'Could not remove the item.' });
  }
}

export async function clearWardrobe(req, res) {
  try {
    const user = pickUser(req, res);
    if (!user) return;
    await WardrobeItem.deleteMany({ user });
    res.json({ ok: true });
  } catch (e) {
    console.error('wardrobe clear error:', e);
    res.status(500).json({ message: 'Could not clear the wardrobe.' });
  }
}