// client/src/components/FitReviewForm.jsx
//
// «Как село?» — отзыв о вещи доставленного заказа: оценка, посадка в целом
// (маломерит / в размер / большемерит), по зонам (необязательно) и текст.
// Эти ответы делают советы размера точнее для всех («люди с похожей фигурой»).

import React, { useState } from 'react';
import { FEEL_LABELS, FIT_LABELS, ZONE_LABELS, submitReview } from '../utils/reviewsApi';
import styles from './FitReview.module.css';

export default function FitReviewForm({ orderId, item, onDone }) {
  const [rating, setRating] = useState(0);
  const [fit, setFit] = useState('');
  const [zones, setZones] = useState({});
  const [text, setText] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    const missing = [
      ...(rating ? [] : ['Please rate the item from 1 to 5 stars.']),
      ...(fit ? [] : ['Please say how the size fits.']),
    ];
    if (missing.length) return setErrors(missing);
    setBusy(true);
    setErrors([]);
    try {
      const saved = await submitReview({ orderId, productId: item.product, size: item.size, rating, fit, zones, text });
      onDone?.(saved);
    } catch (err) {
      setErrors(err.errors?.length ? err.errors : [err.message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={send} aria-label={`Review ${item.title}`}>
      <div className={styles.row}>
        <span className={styles.label}>Rating</span>
        <span className={styles.stars} role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className={n <= rating ? styles.starOn : styles.star} onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Size {item.size || ''}</span>
        <span className={styles.choices} role="radiogroup" aria-label="How does the size fit">
          {Object.entries(FIT_LABELS).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={fit === k}
              className={`${styles.choice} ${fit === k ? styles.on : ''}`} onClick={() => setFit(k)}>
              {label}
            </button>
          ))}
        </span>
      </div>

      <div className={styles.zones}>
        {Object.entries(ZONE_LABELS).map(([z, zl]) => (
          <div key={z} className={styles.row}>
            <span className={styles.label}>{zl} <i>(optional)</i></span>
            <span className={styles.choices} role="radiogroup" aria-label={zl}>
              {Object.entries(FEEL_LABELS).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={zones[z] === k}
                  className={`${styles.choice} ${styles.small} ${zones[z] === k ? styles.on : ''}`}
                  onClick={() => setZones((v) => ({ ...v, [z]: v[z] === k ? undefined : k }))}>
                  {label}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <label className={styles.label}>
        Your review (optional)
        <textarea className="ui-input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="How does it look and feel? Would you take the same size again?" />
      </label>
      {errors.length > 0 && <ul className={styles.errors} role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy}>
        {busy ? 'Sending…' : 'Send review'}
      </button>
    </form>
  );
}
