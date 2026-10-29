// client/src/components/SellerLanding.jsx
//
// Кабинет продавца для гостя: зачем продавать здесь и как начать. Только то, что уже
// работает в магазине (примерка по сетке продавца, совет размера, заказы и остатки) —
// без обещаний комиссий и сроков: их решает владелец.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../brand';
import styles from './SellerLanding.module.css';

const POINTS = [
  ['Every item on the buyer’s own avatar',
    'Add a photo and your size chart. Buyers try the item on a figure built from their measurements — in every size you sell.'],
  ['Size advice from your own chart',
    'Each buyer sees the size that fits them, with tight and loose spots by zone. Fewer “ordered two sizes” and fewer returns.'],
  ['Orders and stock in one place',
    'Stock per size goes down with each order and comes back when one is cancelled. You confirm, ship and close orders from your dashboard.'],
];

const STEPS = [
  'Create a seller account with your store name',
  'Add a product: photos, price, size chart, silhouette',
  'Buyers find it, try it on and order the size that fits',
];

export default function SellerLanding() {
  const nav = useNavigate();
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className="ui-eyebrow">For sellers</span>
        <h1 className={styles.title}>Sell clothes buyers can try on before they order.</h1>
        <p className={styles.lead}>
          {BRAND.name} turns your size chart into a fitting room: buyers see how your item sits on their own figure.
        </p>
        <div className={styles.ctas}>
          <button className="ui-btn ui-btn--primary ui-btn--lg" onClick={() => nav('/register?as=seller')}>Create seller account</button>
          <button className="ui-btn ui-btn--lg" onClick={() => nav('/login?next=/seller')}>Sign in</button>
        </div>
      </section>

      <section className={styles.points}>
        {POINTS.map(([title, text]) => (
          <div key={title} className={`ui-card ${styles.point}`}>
            <h2 className={styles.pointTitle}>{title}</h2>
            <p>{text}</p>
          </div>
        ))}
      </section>

      <section className={styles.steps}>
        <h2 className={styles.pointTitle}>How to start</h2>
        <ol>
          {STEPS.map((s, i) => <li key={s}><b>{i + 1}</b>{s}</li>)}
        </ol>
      </section>
    </main>
  );
}
