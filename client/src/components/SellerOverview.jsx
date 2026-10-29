// client/src/components/SellerOverview.jsx
//
// Сводка вверху кабинета продавца: сколько товаров, сколько заказов и возвратов ждут
// действий, сколько размеров распродано, выручка по доставленным заказам. Товары — список
// блока «My products» (products), заказы — свой запрос; оплаты пока нет — это сумма заказов.

import React, { useEffect, useState } from 'react';
import { sellingOrders } from '../utils/ordersApi';
import { formatPrice } from '../utils/money';
import styles from './SellerOverview.module.css';

export default function SellerOverview({ products }) {
  const [orders, setOrders] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    sellingOrders().then((o) => alive && setOrders(o)).catch(() => alive && setOrders([]));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!products || !orders) return;
    const list = Array.isArray(products) ? products : [];
    const ords = Array.isArray(orders) ? orders : [];
    const delivered = ords.filter((o) => o.status === 'delivered' && o.return?.status !== 'received');
    const revenue = delivered.reduce((m, o) => ({ ...m, [o.currency]: (m[o.currency] || 0) + o.total }), {});
    setData({
      products: list.length,
      soldOut: list.reduce((n, p) => n + (p.sizeChart || []).filter((r) => r.stock === 0).length, 0),
      toHandle: ords.filter((o) => ['placed', 'confirmed', 'shipped'].includes(o.status)).length,
      returns: ords.filter((o) => ['requested', 'accepted'].includes(o.return?.status)).length,
      revenue: Object.entries(revenue),
    });
  }, [products, orders]);

  if (!data) return null;
  const tiles = [
    ['Products', data.products],
    ['Orders to handle', data.toHandle],
    ['Returns to handle', data.returns],
    ['Sold-out sizes', data.soldOut],
    ['Delivered sales', data.revenue.length ? data.revenue.map(([c, v]) => formatPrice(v, c)).join(' · ') : '—'],
  ];
  return (
    <section className={styles.tiles} aria-label="Overview">
      {tiles.map(([label, value]) => (
        <div key={label} className={styles.tile} role="group" aria-label={label}>
          <span className={styles.label}>{label}</span>
          <b className={styles.value}>{value}</b>
        </div>
      ))}
    </section>
  );
}
