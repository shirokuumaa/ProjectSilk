// client/src/utils/ordersApi.js
//
// Заказы на нашем сервере (server/routes/orderRoutes.js). Оплаты пока нет — заказ
// оформляется без неё. Ответ с ошибкой — исключение с текстом сервера для покупателя.

import { authFetch } from './auth';

const API = process.env.REACT_APP_API || 'http://localhost:5050';

export const ORDER_STATUS_LABELS = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
/** Шаги заказа по порядку (отмена — отдельно). */
export const ORDER_STEPS = ['placed', 'confirmed', 'shipped', 'delivered'];
/** Что продавец может сделать из каждого статуса — как на сервере (services/orders.js, SELLER_MOVES). */
export const SELLER_ACTIONS = {
  placed: [['confirmed', 'Confirm order'], ['cancelled', 'Cancel']],
  confirmed: [['shipped', 'Mark as shipped'], ['cancelled', 'Cancel']],
  shipped: [['delivered', 'Mark as delivered']],
  delivered: [],
  cancelled: [],
};

async function call(path, options = {}) {
  let r;
  try {
    r = await authFetch(`${API}${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Please try again.');
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(data?.message || 'Something went wrong. Please try again.');
    err.status = r.status;
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

/** lines — строки корзины: { id, size, quantity }. */
export const placeOrders = (lines, contact, address, note) => call('/api/orders', {
  method: 'POST',
  body: {
    items: lines.map((l) => ({ productId: l.id || l._id, size: l.size || null, quantity: l.quantity || 1 })),
    contact, address, note,
  },
}).then((d) => d.orders);

export const myOrders = () => call('/api/orders/mine');
export const sellingOrders = () => call('/api/orders/selling');
export const getOrder = (id) => call(`/api/orders/${encodeURIComponent(id)}`);
export const cancelOrder = (id) => call(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const setOrderStatus = (id, status) => call(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } });

// ── возвраты доставленного заказа (server/routes/orderRoutes.js) ──
export const RETURN_REASON_LABELS = {
  size: 'Wrong size',
  look: 'Looks different from the pictures',
  quality: 'Quality issue',
  changed_mind: 'Changed my mind',
  other: 'Other',
};
export const RETURN_STATUS_LABELS = {
  requested: 'Return requested — waiting for the seller',
  accepted: 'Return accepted — send the items back to the seller',
  refused: 'Return refused by the seller',
  received: 'Return received — the seller will refund you',
};
export const RETURN_ZONE_LABELS = {
  bust: 'Bust', waist: 'Waist', hips: 'Hips', length: 'Length', shoulders: 'Shoulders', sleeves: 'Sleeves',
};
export const SELLER_RETURN_ACTIONS = {
  requested: [['accepted', 'Accept return'], ['refused', 'Refuse']],
  accepted: [['received', 'Mark items as received']],
};

export const requestReturn = (id, body) => call(`/api/orders/${encodeURIComponent(id)}/return`, { method: 'POST', body });
export const setReturnStatus = (id, status, note) => call(`/api/orders/${encodeURIComponent(id)}/return`, { method: 'PATCH', body: { status, note } });
