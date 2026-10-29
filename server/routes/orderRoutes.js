// server/routes/orderRoutes.js
//
//   POST  /api/orders              — оформить корзину (покупатель; заказ на каждого продавца)
//   GET   /api/orders/mine         — мои заказы
//   GET   /api/orders/selling      — заказы моих товаров (продавец)
//   GET   /api/orders/:id          — заказ: покупатель или продавец этого заказа
//   POST  /api/orders/:id/cancel   — покупатель отменяет, пока продавец не подтвердил
//   PATCH /api/orders/:id/status   — продавец: confirmed / shipped / delivered / cancelled
//   POST  /api/orders/:id/return   — покупатель просит возврат доставленного заказа (причина, зоны)
//   PATCH /api/orders/:id/return   — продавец: accepted / refused, потом received (остаток вернётся)
// Оплаты нет: заказ оформляется без неё («Payment coming soon»).

import express from 'express';
import mongoose from 'mongoose';
import Order, { RETURN_REASONS, RETURN_ZONES } from '../models/Order.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import {
  OrderError, RETURN_DAYS, SELLER_MOVES, moveOrder, parseCheckout, placeOrders, returnStock,
} from '../services/orders.js';

const router = express.Router();
router.use(requireAuth);

const fail = (res, err, next) => {
  if (err instanceof OrderError) return res.status(err.status).json({ message: err.publicMessage });
  return next(err);
};

router.post('/', async (req, res, next) => {
  try {
    const checkout = parseCheckout(req.body);
    if (checkout.errors.length) {
      return res.status(400).json({ message: checkout.errors.join(' '), errors: checkout.errors });
    }
    const orders = await placeOrders(req.user, req.body?.items, checkout);
    res.status(201).json({ orders });
  } catch (err) { fail(res, err, next); }
});

router.get('/mine', async (req, res, next) => {
  try {
    res.json(await Order.find({ buyer: req.user.id }).sort({ createdAt: -1 }).lean());
  } catch (err) { next(err); }
});

router.get('/selling', requireRole('seller'), async (req, res, next) => {
  try {
    res.json(await Order.find({ seller: req.user.id }).sort({ createdAt: -1 }).lean());
  } catch (err) { next(err); }
});

/** Заказ из :id, если он этого покупателя или продавца; иначе 404 (чужие заказы не видны). */
async function loadOrder(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ message: 'Order not found.' }); return null; }
  const order = await Order.findById(req.params.id);
  const mine = order && [String(order.buyer), String(order.seller)].includes(req.user.id);
  if (!mine) { res.status(404).json({ message: 'Order not found.' }); return null; }
  return order;
}

router.get('/:id', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (order) res.json(order);
  } catch (err) { next(err); }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    if (String(order.buyer) !== req.user.id) return res.status(403).json({ message: 'Only the buyer can cancel here.' });
    if (order.status !== 'placed') {
      return res.status(409).json({ message: 'The seller has already confirmed this order — please contact them to cancel.' });
    }
    res.json(await moveOrder(order, 'cancelled', 'buyer'));
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireRole('seller'), async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    if (String(order.seller) !== req.user.id) return res.status(403).json({ message: 'This is not your order.' });
    const status = String(req.body?.status || '');
    if (!SELLER_MOVES[order.status]?.includes(status)) {
      return res.status(409).json({ message: `An order that is ${order.status} cannot become ${status || 'that'}.` });
    }
    res.json(await moveOrder(order, status, 'seller'));
  } catch (err) { next(err); }
});

router.post('/:id/return', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    if (String(order.buyer) !== req.user.id) return res.status(403).json({ message: 'Only the buyer can ask for a return.' });
    if (order.status !== 'delivered') return res.status(409).json({ message: 'A return can be requested once the order is delivered.' });
    if (order.return) return res.status(409).json({ message: 'A return has already been requested for this order.' });
    const deliveredAt = [...order.history].reverse().find((h) => h.status === 'delivered')?.at;
    if (deliveredAt && Date.now() - new Date(deliveredAt).getTime() > RETURN_DAYS * 86400e3) {
      return res.status(409).json({ message: `Returns are possible within ${RETURN_DAYS} days of delivery.` });
    }
    const b = req.body || {};
    if (!RETURN_REASONS.includes(b.reason)) return res.status(400).json({ message: 'Please choose why you are returning the order.' });
    const zones = (list) => [...new Set((Array.isArray(list) ? list : []).filter((z) => RETURN_ZONES.includes(z)))];
    order.return = {
      status: 'requested', reason: b.reason,
      tooSmall: b.reason === 'size' ? zones(b.tooSmall) : [],
      tooBig: b.reason === 'size' ? zones(b.tooBig) : [],
      note: String(b.note ?? '').trim().slice(0, 500) || undefined,
      requestedAt: new Date(),
    };
    order.history.push({ status: 'return_requested', at: new Date(), by: 'buyer' });
    await order.save();
    res.json(order);
  } catch (err) { next(err); }
});

// продавец: requested → accepted | refused; accepted → received (вещи вернулись — остаток назад)
const RETURN_MOVES = { requested: ['accepted', 'refused'], accepted: ['received'] };

router.patch('/:id/return', requireRole('seller'), async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    if (String(order.seller) !== req.user.id) return res.status(403).json({ message: 'This is not your order.' });
    const status = String(req.body?.status || '');
    if (!order.return || !RETURN_MOVES[order.return.status]?.includes(status)) {
      return res.status(409).json({ message: 'This return cannot move to that step.' });
    }
    order.return.status = status;
    order.return.decidedAt = new Date();
    const note = String(req.body?.note ?? '').trim().slice(0, 500);
    if (note) order.return.sellerNote = note;
    if (status === 'received') {
      // вещи у продавца — остаток назад (списанное при заказе)
      await returnStock(order.items);
      order.items.forEach((it) => { it.stockTaken = false; });
    }
    order.history.push({ status: `return_${status}`, at: new Date(), by: 'seller' });
    order.markModified('return');
    await order.save();
    res.json(order);
  } catch (err) { next(err); }
});

export default router;
