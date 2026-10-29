// client/src/pages/CheckoutPage.jsx
//
// Оформление заказа без оплаты: контакты, адрес (страна из списка — место под другие
// рынки), комментарий; справа — что заказываем. Оплаты пока нет: «Payment coming soon» —
// продавец связывается с покупателем. Корзина с вещами разных продавцов становится
// несколькими заказами; оформленные строки уходят из корзины.

import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { cartLineKey, cartTotals } from '../utils/cart';
import { formatPrice } from '../utils/money';
import { COUNTRIES, DEFAULT_COUNTRY } from '../utils/countries';
import { placeOrders } from '../utils/ordersApi';
import { getUsername, isLoggedIn } from '../utils/auth';
import styles from './Shop.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);
const LAST_KEY = 'checkoutContact';   // последние контакты и адрес — подставить в следующий раз

const lastDetails = () => {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null') || {}; } catch { return {}; }
};

export default function CheckoutPage({ cartItems, onOrdered }) {
  const nav = useNavigate();
  const saved = lastDetails();
  const [contact, setContact] = useState({ name: '', phone: '', email: '', ...saved.contact });
  const [address, setAddress] = useState({ country: DEFAULT_COUNTRY, city: '', line1: '', line2: '', postcode: '', ...saved.address });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  if (!isLoggedIn()) return <Navigate to="/login?next=/checkout" replace />;
  const lines = cartItems || [];
  if (!lines.length) {
    return (
      <main className={`ui-container ${styles.page}`}>
        <h1 className={styles.title}>Checkout</h1>
        <div className={styles.empty}>
          <p className={styles.muted}>Your cart is empty.</p>
          <Link to="/" className="ui-btn ui-btn--primary">Browse the shop</Link>
        </div>
      </main>
    );
  }

  const totals = Object.entries(cartTotals(lines));
  const setC = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));
  const setA = (k) => (e) => setAddress((a) => ({ ...a, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const missing = [
      ...(contact.name.trim().length >= 2 ? [] : ['Please enter your name.']),
      ...(/^\+?[0-9 ()-]{6,24}$/.test(contact.phone.trim()) ? [] : ['Please enter a phone number.']),
      ...(address.city.trim() ? [] : ['Please enter a city.']),
      ...(address.line1.trim() ? [] : ['Please enter a street address.']),
    ];
    if (missing.length) return setErrors(missing);
    setBusy(true);
    setErrors([]);
    try {
      const orders = await placeOrders(lines, contact, address, note);
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ contact, address })); } catch {}
      onOrdered?.(lines.map(cartLineKey));
      nav(orders.length === 1 ? `/orders/${orders[0]._id}?placed=1` : '/orders?placed=1');
    } catch (err) {
      setErrors(err.errors?.length ? err.errors : [err.message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`ui-container ${styles.page}`}>
      <h1 className={styles.title}>Checkout</h1>
      <form className={styles.layout} onSubmit={submit} noValidate>
        <div className={styles.form}>
          <section className={`ui-card ${styles.panel}`}>
            <h2 className={styles.panelTitle}>Contact</h2>
            <div className={styles.fields}>
              <label className={styles.label}>Full name
                <input className="ui-input" value={contact.name} onChange={setC('name')} autoComplete="name" />
              </label>
              <label className={styles.label}>Phone
                <input className="ui-input" value={contact.phone} onChange={setC('phone')} autoComplete="tel" placeholder="+7 701 000 00 00" />
              </label>
              <label className={`${styles.label} ${styles.fieldWide}`}>Email (optional)
                <input className="ui-input" type="email" value={contact.email} onChange={setC('email')} autoComplete="email" />
              </label>
            </div>
            <p className={styles.note}>Signed in as {getUsername()}. The seller uses these details to arrange payment and delivery.</p>
          </section>

          <section className={`ui-card ${styles.panel}`}>
            <h2 className={styles.panelTitle}>Delivery address</h2>
            <div className={styles.fields}>
              <label className={styles.label}>Country
                <select className="ui-input" value={address.country} onChange={setA('country')} autoComplete="country">
                  {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </label>
              <label className={styles.label}>City
                <input className="ui-input" value={address.city} onChange={setA('city')} autoComplete="address-level2" />
              </label>
              <label className={`${styles.label} ${styles.fieldWide}`}>Street address
                <input className="ui-input" value={address.line1} onChange={setA('line1')} autoComplete="address-line1" placeholder="Street, house, apartment" />
              </label>
              <label className={styles.label}>Address line 2 (optional)
                <input className="ui-input" value={address.line2} onChange={setA('line2')} autoComplete="address-line2" />
              </label>
              <label className={styles.label}>Postcode (optional)
                <input className="ui-input" value={address.postcode} onChange={setA('postcode')} autoComplete="postal-code" />
              </label>
              <label className={`${styles.label} ${styles.fieldWide}`}>Note for the seller (optional)
                <textarea className="ui-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </section>

          <section className={styles.payment} aria-label="Payment">
            <span className="ui-chip ui-chip--dark">Payment coming soon</span>
            <span className={styles.muted}>
              <b>Online payment is not available yet.</b> Placing the order reserves your size; the seller
              will contact you to arrange payment and delivery.
            </span>
          </section>
        </div>

        <aside className={`ui-card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Your order</h2>
          <ul className={styles.lines} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((item) => (
              <li key={cartLineKey(item)} className={styles.line} style={{ gridTemplateColumns: '52px minmax(0,1fr) auto' }}>
                <img className={`${styles.thumb} ${styles.thumbSm}`} src={toPublicUrl(item.image)} alt="" />
                <div>
                  <div className={styles.lineName}>{item.name}</div>
                  <div className={styles.lineMeta}>{item.size ? `Size ${item.size}` : 'One size'} · × {item.quantity || 1}</div>
                </div>
                <div className={styles.linePrice}>{formatPrice((item.price || 0) * (item.quantity || 1), item.currency)}</div>
              </li>
            ))}
          </ul>
          {totals.map(([currency, sum]) => (
            <div key={currency} className={`${styles.sumRow} ${styles.sumTotal}`}><span>Total</span><span>{formatPrice(sum, currency)}</span></div>
          ))}
          {errors.length > 0 && (
            <ul className={styles.errors} role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
          <button type="submit" className={`ui-btn ui-btn--primary ui-btn--lg ${styles.full}`} disabled={busy}>
            {busy ? 'Placing your order…' : 'Place order'}
          </button>
          <p className={styles.note}>Items from different stores become separate orders — one per store.</p>
        </aside>
      </form>
    </main>
  );
}
