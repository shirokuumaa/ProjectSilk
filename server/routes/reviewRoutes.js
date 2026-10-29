// server/routes/reviewRoutes.js — отзывы о посадке
//
//   POST /api/reviews                    — отзыв о вещи доставленного заказа (покупатель этого заказа)
//   GET  /api/reviews/mine               — мои отзывы (какие вещи заказов уже оценены)
//   GET  /api/reviews/product/:id        — отзывы вещи и сводка: оценка, «в размер / мало / велико»
//   GET  /api/reviews/similar/:id        — что брали люди с похожей фигурой (по обмерам вошедшего)
// Обмеры авторов не отдаются никогда; «похожие» показываются, только когда их хотя бы
// SIMILAR_MIN — чтобы по сводке нельзя было узнать конкретного человека.

import express from 'express';
import mongoose from 'mongoose';
import Review, { FIT_VERDICTS, ZONE_FEEL } from '../models/Review.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import BodyProfile from '../models/BodyProfile.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

export const SIMILAR_MIN = 3;
// похожая фигура: рост ±6 см, обхваты ±5 см
const NEAR = { heightCm: 6, chest: 5, waist: 5, hips: 5 };

const publicReview = (r) => ({
  _id: r._id, author: r.author, size: r.size, rating: r.rating, fit: r.fit, zones: r.zones || {},
  text: r.text, heightCm: r.body?.heightCm ? Math.round(r.body.heightCm) : undefined, createdAt: r.createdAt,
});

/** Пересчитать среднюю оценку и число отзывов у товара (карточка каталога). */
async function refreshRating(productId) {
  const [agg] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  await Product.updateOne({ _id: productId }, { rating: agg ? Math.round(agg.avg * 10) / 10 : 0, reviewCount: agg?.n || 0 });
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(b.orderId) || !mongoose.isValidObjectId(b.productId)) {
      return res.status(400).json({ message: 'Choose an item from your order.' });
    }
    const order = await Order.findById(b.orderId).lean();
    if (!order || String(order.buyer) !== req.user.id) return res.status(404).json({ message: 'Order not found.' });
    if (order.status !== 'delivered') return res.status(409).json({ message: 'You can review an item once it is delivered.' });
    const size = b.size ? String(b.size) : undefined;
    const item = order.items.find((it) => String(it.product) === String(b.productId) && (it.size || undefined) === size);
    if (!item) return res.status(400).json({ message: 'This item is not in the order.' });

    const errors = [];
    const rating = Math.round(Number(b.rating));
    if (!(rating >= 1 && rating <= 5)) errors.push('Please rate the item from 1 to 5 stars.');
    if (!FIT_VERDICTS.includes(b.fit)) errors.push('Please say how the size fits.');
    const zones = {};
    for (const z of ['bust', 'waist', 'hips', 'length']) {
      const v = b.zones?.[z];
      if (v == null || v === '') continue;
      if (!ZONE_FEEL.includes(v)) errors.push(`Unknown answer for ${z}.`); else zones[z] = v;
    }
    const text = String(b.text ?? '').trim();
    if (text.length > 1000) errors.push('The review is too long (maximum 1000 characters).');
    if (errors.length) return res.status(400).json({ message: errors.join(' '), errors });

    if (await Review.exists({ order: order._id, product: item.product, size: item.size })) {
      return res.status(409).json({ message: 'You have already reviewed this item.' });
    }
    const profile = await BodyProfile.findOne({ user: req.user.username }).lean();
    const review = await Review.create({
      product: item.product, order: order._id, buyer: req.user.id,
      author: `${req.user.username.charAt(0).toUpperCase()}.`,
      size: item.size, rating, fit: b.fit, zones, text: text || undefined,
      body: profile ? { heightCm: profile.heightCm, chest: profile.chest, waist: profile.waist, hips: profile.hips } : undefined,
    });
    await refreshRating(item.product);
    res.status(201).json(publicReview(review));
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: 'You have already reviewed this item.' });
    next(err);
  }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const list = await Review.find({ buyer: req.user.id }, { order: 1, product: 1, size: 1, rating: 1, fit: 1 }).lean();
    res.json(list);
  } catch (err) { next(err); }
});

router.get('/product/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.json({ reviews: [], summary: { count: 0 } });
    const list = await Review.find({ product: req.params.id }).sort({ createdAt: -1 }).lean();
    const fit = Object.fromEntries(FIT_VERDICTS.map((f) => [f, list.filter((r) => r.fit === f).length]));
    const avg = list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : 0;
    res.json({ reviews: list.map(publicReview), summary: { count: list.length, rating: avg, fit } });
  } catch (err) { next(err); }
});

router.get('/similar/:id', requireAuth, async (req, res, next) => {
  try {
    const me = await BodyProfile.findOne({ user: req.user.username }).lean();
    if (!me || !mongoose.isValidObjectId(req.params.id)) return res.json({ count: 0 });
    const list = await Review.find({ product: req.params.id, buyer: { $ne: req.user.id }, body: { $exists: true } }).lean();
    const near = list.filter((r) => Object.entries(NEAR).every(([k, d]) => Math.abs((r.body?.[k] ?? Infinity) - me[k]) <= d));
    if (near.length < SIMILAR_MIN) return res.json({ count: near.length, enough: false });
    // какой размер «в размер» чаще всего у похожих; если «в размер» не было — что брали вообще
    const pool = near.filter((r) => r.fit === 'true').length ? near.filter((r) => r.fit === 'true') : near;
    const bySize = pool.reduce((m, r) => m.set(r.size, (m.get(r.size) || 0) + 1), new Map());
    const [size, n] = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0];
    res.json({ enough: true, count: near.length, size, sizeCount: n, trueToSize: near.filter((r) => r.fit === 'true').length });
  } catch (err) { next(err); }
});

export default router;
