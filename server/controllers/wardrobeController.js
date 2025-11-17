// server/controllers/wardrobeController.js
import WardrobeItem from '../models/WardrobeItem.js';

const pickUser = (req) => String(req.query.user || req.headers['x-user'] || '').trim();

export async function listWardrobe(req, res) {
  try {
    const user = pickUser(req);
    if (!user) return res.status(400).json({ message: 'user is required' });
    const items = await WardrobeItem.find({ user }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'list error', error: String(e?.message || e) });
  }
}

export async function addWardrobeItem(req, res) {
  try {
    const user = pickUser(req);
    if (!user) return res.status(400).json({ message: 'user is required' });
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
    const user = pickUser(req);
    if (!user) return res.status(400).json({ message: 'user is required' });
    const { productId } = req.params;
    await WardrobeItem.deleteOne({ user, productId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'remove error', error: String(e?.message || e) });
  }
}

export async function clearWardrobe(req, res) {
  try {
    const user = pickUser(req);
    if (!user) return res.status(400).json({ message: 'user is required' });
    await WardrobeItem.deleteMany({ user });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'clear error', error: String(e?.message || e) });
  }
}