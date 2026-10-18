// server/controllers/wardrobeController.js
import mongoose from 'mongoose';
import WardrobeItem from '../models/WardrobeItem.js';
import Product from '../models/Product.js';
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

    // товар могли удалить (в т.ч. до того, как удаление стало чистить гардеробы) —
    // такие вещи убираем из гардероба, а не отдаём битыми
    const ids = items.map((i) => i.productId).filter((id) => mongoose.isValidObjectId(id));
    const alive = new Set(
      (await Product.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((p) => String(p._id)),
    );
    const gone = items.filter((i) => !alive.has(i.productId)).map((i) => i.productId);
    if (gone.length) await WardrobeItem.deleteMany({ user, productId: { $in: gone } });

    res.json(items.filter((i) => alive.has(i.productId)));
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
    if (!mongoose.isValidObjectId(productId) || !(await Product.exists({ _id: productId }))) {
      return res.status(404).json({ message: 'Product not found.' });
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