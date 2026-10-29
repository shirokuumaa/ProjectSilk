// server/services/orders.js
//
// Оформление заказа без оплаты: проверка корзины по каталогу, цены с сервера, деление
// по продавцам, списание остатка размера (атомарно, без ухода в минус) и его возврат
// при отмене. Транзакций у локального mongod нет — при сбое списанное возвращается вручную.

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';

/** Ошибка оформления: publicMessage — наш текст для покупателя (тексты исключений наружу не уходят). */
export class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.publicMessage = message; }
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Контакты и адрес из формы; ошибки — все сразу, словами для покупателя. */
export function parseCheckout(body = {}) {
  const c = body.contact || {};
  const a = body.address || {};
  const contact = { name: clean(c.name, 80), phone: clean(c.phone, 24), email: clean(c.email, 120) || undefined };
  const address = {
    country: clean(a.country, 2).toUpperCase(),
    city: clean(a.city, 80),
    line1: clean(a.line1, 160),
    line2: clean(a.line2, 160) || undefined,
    postcode: clean(a.postcode, 20) || undefined,
  };
  const errors = [];
  if (contact.name.length < 2) errors.push('Please enter your name.');
  if (!PHONE_RE.test(contact.phone)) errors.push('Please enter a phone number.');
  if (contact.email && !EMAIL_RE.test(contact.email)) errors.push('The email address does not look right.');
  if (!/^[A-Z]{2}$/.test(address.country)) errors.push('Please choose a country.');
  if (!address.city) errors.push('Please enter a city.');
  if (!address.line1) errors.push('Please enter a street address.');
  return { contact, address, note: clean(body.note, 500) || undefined, errors };
}

/** Номер для людей: PS-ГГММДД-XXXX. */
const orderNumber = () => {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `PS-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

/** Списать quantity штук размера; остаток не ведётся — true без изменений. */
async function takeStock(productId, size, quantity) {
  if (!size) return { ok: true, taken: false };
  const product = await Product.findById(productId, { sizeChart: 1 }).lean();
  const row = product?.sizeChart?.find((r) => r.size === size);
  if (!row || row.stock == null) return { ok: true, taken: false };
  const r = await Product.updateOne(
    { _id: productId, sizeChart: { $elemMatch: { size, stock: { $gte: quantity } } } },
    { $inc: { 'sizeChart.$.stock': -quantity } },
  );
  return { ok: r.modifiedCount === 1, taken: r.modifiedCount === 1 };
}

/** Вернуть остаток (отмена, сбой оформления). */
export async function returnStock(items) {
  for (const it of items) {
    if (!it.stockTaken || !it.size) continue;
    await Product.updateOne(
      { _id: it.product, 'sizeChart.size': it.size },
      { $inc: { 'sizeChart.$.stock': it.quantity } },
    );
  }
}

/**
 * Оформить корзину. lines: [{ productId, size, quantity }].
 * @returns {Promise<Order[]>} заказы — по одному на продавца
 */
export async function placeOrders(user, lines, checkout) {
  if (!Array.isArray(lines) || !lines.length) throw new OrderError('Your cart is empty.');
  if (lines.length > 50) throw new OrderError('Too many items in one order.');

  // одинаковые вещь + размер — одной строкой
  const merged = new Map();
  for (const l of lines) {
    const productId = String(l?.productId || '');
    const size = l?.size ? String(l.size) : null;
    const quantity = Math.floor(Number(l?.quantity) || 0);
    if (!mongoose.isValidObjectId(productId)) throw new OrderError('An item in your cart is no longer available.');
    if (quantity < 1 || quantity > 20) throw new OrderError('Quantity must be between 1 and 20.');
    const key = `${productId}|${size || ''}`;
    merged.set(key, { productId, size, quantity: (merged.get(key)?.quantity || 0) + quantity });
  }

  const ids = [...new Set([...merged.values()].map((l) => l.productId))];
  const products = new Map((await Product.find({ _id: { $in: ids } }).lean()).map((p) => [String(p._id), p]));

  const items = [];
  for (const l of merged.values()) {
    const p = products.get(l.productId);
    if (!p) throw new OrderError('An item in your cart is no longer available.');
    const chart = p.sizeChart || [];
    if (chart.length && !l.size) throw new OrderError(`Please choose a size for ${p.title}.`);
    if (chart.length && !chart.some((r) => r.size === l.size)) {
      throw new OrderError(`Size ${l.size} of ${p.title} is not available.`);
    }
    if (!chart.length && l.size) l.size = null;
    items.push({
      product: p._id, seller: String(p.owner), title: p.title, image: p.image,
      size: l.size || undefined, price: p.price, currency: p.currency || 'KZT', quantity: l.quantity,
    });
  }
  if (new Set(items.map((i) => i.currency)).size > 1) {
    throw new OrderError('Items in different currencies cannot be ordered together yet.');
  }

  // остаток: списываем по строке; не хватило — вернуть уже списанное
  const taken = [];
  for (const it of items) {
    const r = await takeStock(it.product, it.size, it.quantity);
    if (!r.ok) {
      await returnStock(taken);
      const left = products.get(String(it.product)).sizeChart.find((x) => x.size === it.size)?.stock ?? 0;
      throw new OrderError(left > 0
        ? `Only ${left} left of ${it.title} in size ${it.size}.`
        : `${it.title} in size ${it.size} is sold out.`, 409);
    }
    it.stockTaken = r.taken;
    if (r.taken) taken.push(it);
  }

  try {
    const bySeller = new Map();
    items.forEach((it) => bySeller.set(it.seller, [...(bySeller.get(it.seller) || []), it]));
    const sellers = new Map((await User.find({ _id: { $in: [...bySeller.keys()] } }, { storeName: 1 }).lean())
      .map((u) => [String(u._id), u.storeName]));
    const now = new Date();
    const orders = [];
    for (const [seller, list] of bySeller) {
      const subtotal = list.reduce((s, it) => s + it.price * it.quantity, 0);
      orders.push(await Order.create({
        number: orderNumber(),
        buyer: user.id, buyerUsername: user.username,
        seller, storeName: sellers.get(seller),
        items: list.map(({ seller: _s, currency: _c, ...it }) => it),
        currency: list[0].currency, subtotal, shipping: 0, total: subtotal,
        contact: checkout.contact, address: checkout.address, note: checkout.note,
        history: [{ status: 'placed', at: now, by: 'buyer' }],
      }));
    }
    return orders;
  } catch (err) {
    await returnStock(taken);
    throw err;
  }
}

/** Сколько дней после доставки можно попросить возврат (правило магазина — решает владелец). */
export const RETURN_DAYS = 14;

/** Куда можно перейти из статуса: продавец ведёт заказ вперёд или отменяет до отправки. */
export const SELLER_MOVES = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Сменить статус; отмена возвращает остаток. by — 'buyer' | 'seller'. */
export async function moveOrder(order, status, by) {
  order.status = status;
  order.history.push({ status, at: new Date(), by });
  if (status === 'cancelled') {
    await returnStock(order.items);
    order.items.forEach((it) => { it.stockTaken = false; });
  }
  await order.save();
  return order;
}
