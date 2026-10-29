// client/src/components/StockField.jsx
//
// Остаток по размерам в форме продавца. Хранится в строке сетки (sizeChart[i].stock):
// пусто — продавец не ведёт остаток (размер считается в наличии), 0 — нет в наличии.
// При оформлении заказа остаток будет уменьшаться — когда появятся заказы.

import React from 'react';

export default function StockField({ rows, onChange }) {
  const sized = (rows || []).filter((r) => String(r.size || '').trim());
  if (!sized.length) return null;

  const setStock = (row, stock) => onChange(rows.map((r) => (r === row ? { ...r, stock } : r)));

  return (
    <div style={styles.box}>
      <div style={styles.title}>In stock</div>
      <div style={styles.note}>Pieces of each size you have. Empty — you do not count stock; 0 — sold out.</div>
      <div style={styles.grid}>
        {sized.map((r) => (
          <label key={r.size} style={styles.cell}>
            <span style={styles.size}>{r.size}</span>
            <input
              type="number" min="0" step="1"
              aria-label={`Stock of size ${r.size}`}
              value={r.stock ?? ''}
              onChange={(e) => setStock(r, e.target.value)}
              placeholder="—"
              style={styles.input}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const styles = {
  box: { display: 'grid', gap: 6 },
  title: { fontSize: 14, fontWeight: 500, color: 'var(--ink)' },
  note: { fontSize: 13, color: 'var(--muted)' },
  grid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  cell: { display: 'grid', gap: 4, justifyItems: 'center' },
  size: { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)' },
  input: { width: 64, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)', textAlign: 'center' },
};
