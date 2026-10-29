// client/src/components/ReturnRequestForm.jsx
//
// Заявка на возврат доставленного заказа: причина; если «Wrong size» — где тесно и где
// велико (это главные данные для точности советов размера); комментарий.

import React, { useState } from 'react';
import { RETURN_REASON_LABELS, RETURN_ZONE_LABELS, requestReturn } from '../utils/ordersApi';
import styles from './FitReview.module.css';

export default function ReturnRequestForm({ orderId, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [tooSmall, setTooSmall] = useState([]);
  const [tooBig, setTooBig] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const flip = (list, set, z) => set(list.includes(z) ? list.filter((x) => x !== z) : [...list, z]);

  const send = async (e) => {
    e.preventDefault();
    if (!reason) return setError('Please choose why you are returning the order.');
    setBusy(true);
    setError('');
    try {
      onDone?.(await requestReturn(orderId, { reason, tooSmall, tooBig, note }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={send} aria-label="Request a return">
      <div className={styles.row}>
        <span className={styles.choices} role="radiogroup" aria-label="Reason">
          {Object.entries(RETURN_REASON_LABELS).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={reason === k}
              className={`${styles.choice} ${reason === k ? styles.on : ''}`} onClick={() => setReason(k)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      {reason === 'size' && (
        <>
          {[['Too tight / short at', tooSmall, setTooSmall], ['Too loose / long at', tooBig, setTooBig]].map(([title, list, set]) => (
            <div key={title} className={styles.row}>
              <span className={styles.label}>{title}</span>
              <span className={styles.choices} role="group" aria-label={title}>
                {Object.entries(RETURN_ZONE_LABELS).map(([z, label]) => (
                  <button key={z} type="button" aria-pressed={list.includes(z)}
                    className={`${styles.choice} ${styles.small} ${list.includes(z) ? styles.on : ''}`} onClick={() => flip(list, set, z)}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </>
      )}
      <label className={styles.label}>
        Comment for the seller (optional)
        <textarea className="ui-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className={styles.errors} role="alert">{error}</p>}
      <span className={styles.row}>
        <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy}>{busy ? 'Sending…' : 'Send return request'}</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
      </span>
    </form>
  );
}
