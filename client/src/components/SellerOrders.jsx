// client/src/components/SellerOrders.jsx
//
// Заказы в кабинете продавца: новые сверху, вещи с размерами, контакты и адрес покупателя,
// кнопки следующего шага (подтвердить → отправлен → доставлен, отменить до отправки).
// Оплаты пока нет — продавец сам договаривается с покупателем.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ORDER_STATUS_LABELS, RETURN_REASON_LABELS, RETURN_STATUS_LABELS, RETURN_ZONE_LABELS, SELLER_ACTIONS,
  SELLER_RETURN_ACTIONS, sellingOrders, setOrderStatus, setReturnStatus,
} from '../utils/ordersApi';
import { formatPrice } from '../utils/money';
import { countryName } from '../utils/countries';
import styles from './SellerOrders.module.css';

const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function SellerOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    sellingOrders()
      .then((list) => setOrders(Array.isArray(list) ? list : []))
      .catch((e) => { setOrders([]); setError(e.message); });
  }, []);
  useEffect(load, [load]);

  const move = async (order, status) => {
    if (status === 'cancelled' && !window.confirm(`Cancel order ${order.number}? The items go back to your stock.`)) return;
    setBusy(order._id);
    setError('');
    try {
      const next = await setOrderStatus(order._id, status);
      setOrders((list) => list.map((o) => (o._id === next._id ? next : o)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const moveReturn = async (order, status) => {
    setBusy(order._id);
    setError('');
    try {
      const next = await setReturnStatus(order._id, status);
      setOrders((list) => list.map((o) => (o._id === next._id ? next : o)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const zoneList = (zs) => (zs || []).map((z) => RETURN_ZONE_LABELS[z] || z).join(', ');

  const open = (orders || []).filter((o) => !['delivered', 'cancelled'].includes(o.status)
    || ['requested', 'accepted'].includes(o.return?.status)).length;

  return (
    <section className={styles.box}>
      <h3 className={styles.title}>
        Orders{orders ? ` · ${orders.length}` : ''}
        {open > 0 && <span className={styles.open}>{open} to handle</span>}
      </h3>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!orders && <p className={styles.muted}>Loading orders…</p>}
      {orders && orders.length === 0 && <p className={styles.muted}>No orders yet. They appear here as soon as a buyer places one.</p>}

      <div className={styles.list}>
        {(orders || []).map((o) => (
          <article key={o._id} className={styles.order}>
            <div className={styles.head}>
              <span><b className={styles.no}>{o.number}</b> <span className={styles.muted}>· {when(o.createdAt)}</span></span>
              <span className={`${styles.status} ${styles[o.status] || ''}`}>{ORDER_STATUS_LABELS[o.status]}</span>
            </div>
            <ul className={styles.items}>
              {o.items.map((it, i) => (
                <li key={`${it.product}-${it.size}-${i}`}>
                  {it.title} · {it.size ? `size ${it.size}` : 'one size'} · × {it.quantity}
                  <span className={styles.muted}> — {formatPrice(it.price * it.quantity, o.currency)}</span>
                </li>
              ))}
            </ul>
            <div className={styles.buyer}>
              <span><b>{o.contact.name}</b> · {o.contact.phone}{o.contact.email ? ` · ${o.contact.email}` : ''}</span>
              <span className={styles.muted}>
                {[o.address.line1, o.address.line2, o.address.city, o.address.postcode, countryName(o.address.country)].filter(Boolean).join(', ')}
              </span>
              {o.note && <span className={styles.muted}>Note: {o.note}</span>}
            </div>
            {o.return && (
              <div className={styles.buyer}>
                <b>{RETURN_STATUS_LABELS[o.return.status]}</b>
                <span>Reason: {RETURN_REASON_LABELS[o.return.reason]}
                  {o.return.tooSmall?.length ? ` · tight at ${zoneList(o.return.tooSmall)}` : ''}
                  {o.return.tooBig?.length ? ` · loose at ${zoneList(o.return.tooBig)}` : ''}
                </span>
                {o.return.note && <span className={styles.muted}>Buyer: {o.return.note}</span>}
                <span className={styles.actions}>
                  {(SELLER_RETURN_ACTIONS[o.return.status] || []).map(([status, label]) => (
                    <button key={status} className={status === 'refused' ? styles.btn : styles.btnDark}
                      onClick={() => moveReturn(o, status)} disabled={busy === o._id}>
                      {label}
                    </button>
                  ))}
                </span>
              </div>
            )}
            <div className={styles.foot}>
              <b>Total {formatPrice(o.total, o.currency)}</b>
              <span className={styles.actions}>
                {(SELLER_ACTIONS[o.status] || []).map(([status, label]) => (
                  <button
                    key={status}
                    className={status === 'cancelled' ? styles.btn : styles.btnDark}
                    onClick={() => move(o, status)}
                    disabled={busy === o._id}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
