// client/src/pages/CartPage.jsx
//
// Корзина: строки «вещь + размер», количество, итог по валюте, переход к оформлению.
// Оформить может только вошедший покупатель — гостю предлагаем войти.

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cartLineKey, cartTotals } from '../utils/cart';
import { formatPrice } from '../utils/money';
import { isLoggedIn } from '../utils/auth';
import styles from './Shop.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);

export default function CartPage({ cartItems, onRemove, onSetQuantity }) {
  const nav = useNavigate();
  const lines = cartItems || [];
  const count = lines.reduce((s, x) => s + (x.quantity || 1), 0);
  const totals = Object.entries(cartTotals(lines));
  const setQty = (item, q) => (onSetQuantity ? onSetQuantity(cartLineKey(item), q) : onRemove(cartLineKey(item)));

  if (!lines.length) {
    return (
      <main className={`ui-container ${styles.page}`}>
        <h1 className={styles.title}>Your cart</h1>
        <div className={styles.empty}>
          <p className={styles.muted}>Your cart is empty.</p>
          <Link to="/" className="ui-btn ui-btn--primary">Browse the shop</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={`ui-container ${styles.page}`}>
      <h1 className={styles.title}>Your cart <span className={styles.muted}>· {count} {count === 1 ? 'item' : 'items'}</span></h1>
      <div className={styles.layout}>
        <section className={`ui-card ${styles.panel}`}>
          <ul className={styles.lines} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((item) => (
              <li key={cartLineKey(item)} className={styles.line}>
                <img className={styles.thumb} src={toPublicUrl(item.image)} alt="" />
                <div>
                  <Link to={`/product/${item.id || item._id}`} className={styles.lineName}>{item.name}</Link>
                  <div className={styles.lineMeta}>{item.size ? `Size ${item.size}` : 'One size'}</div>
                  <div>
                    <span className={styles.qty}>
                      <button aria-label={`One less ${item.name}`} onClick={() => setQty(item, (item.quantity || 1) - 1)}>−</button>
                      <span aria-label="Quantity">{item.quantity || 1}</span>
                      <button aria-label={`One more ${item.name}`} onClick={() => setQty(item, (item.quantity || 1) + 1)}>+</button>
                    </span>
                    <button className={styles.remove} onClick={() => setQty(item, 0)}>Remove</button>
                  </div>
                </div>
                <div className={styles.linePrice}>{formatPrice((item.price || 0) * (item.quantity || 1), item.currency)}</div>
              </li>
            ))}
          </ul>
        </section>

        <aside className={`ui-card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Summary</h2>
          {totals.map(([currency, sum]) => (
            <div key={currency} className={styles.sumRow}><span>Items</span><span>{formatPrice(sum, currency)}</span></div>
          ))}
          <div className={styles.sumRow}><span>Delivery</span><span className={styles.muted}>Agreed with the seller</span></div>
          {totals.map(([currency, sum]) => (
            <div key={currency} className={`${styles.sumRow} ${styles.sumTotal}`}><span>Total</span><span>{formatPrice(sum, currency)}</span></div>
          ))}
          <button
            className={`ui-btn ui-btn--primary ui-btn--lg ${styles.full}`}
            onClick={() => nav(isLoggedIn() ? '/checkout' : '/login?next=/checkout')}
          >
            Checkout
          </button>
          {!isLoggedIn() && <p className={styles.note}>You will be asked to sign in first.</p>}
        </aside>
      </div>
    </main>
  );
}
