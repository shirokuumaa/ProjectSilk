// client/src/components/SizePicker.jsx
//
// Выбор размера на странице товара: рекомендованный по обмерам отмечен точкой,
// нет в наличии (stock 0) — серым и не нажимается, осталось мало — «N left».

import React from 'react';
import styles from './SizePicker.module.css';

const LOW_STOCK = 3;

export default function SizePicker({ rows, value, recommended, onChange }) {
  if (!rows?.length) return null;
  return (
    <div className={styles.box}>
      <div className={styles.header}>
        Size{value ? <span className={styles.chosen}> · {value}</span> : null}
      </div>
      <div className={styles.row} role="group" aria-label="Size">
        {rows.map((r) => {
          const out = r.stock === 0;
          const low = !out && Number.isInteger(r.stock) && r.stock <= LOW_STOCK;
          return (
            <button
              key={r.size}
              type="button"
              disabled={out}
              aria-pressed={r.size === value}
              title={out ? 'Out of stock' : r.size === recommended ? 'Recommended for you' : undefined}
              className={[styles.size, r.size === value ? styles.on : '', out ? styles.out : ''].join(' ')}
              onClick={() => onChange(r.size)}
            >
              <span className={out ? styles.strike : undefined}>{r.size}</span>
              {r.size === recommended && <span className={styles.rec} aria-label="recommended">●</span>}
              {out && <span className={styles.sub}>out of stock</span>}
              {low && <span className={styles.sub}>{r.stock} left</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
