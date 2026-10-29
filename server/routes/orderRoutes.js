// server/routes/orderRoutes.js
//
//   POST  /api/orders              — оформить корзину (покупатель; заказ на каждого продавца)
//   GET   /api/orders/mine         — мои заказы
//   GET   /api/orders/selling      — заказы моих товаров (продавец)
//   GET   /api/orders/:id          — заказ: покупатель или продавец этого заказа
//   POST  /api/orders/:id/cancel   — покупатель отменяет, пока продавец не подтвердил
//   PATCH /api/orders/:id/status   — продавец: confirmed / shipped / delivered / cancelled
// Оплаты нет: заказ оформляется без неё («Payment coming soon»).

import express from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { OrderError, SELLER_MOVES, moveOrder, parseCheckout, placeOrders } from '../services/orders.js';

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

export default router;
