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
