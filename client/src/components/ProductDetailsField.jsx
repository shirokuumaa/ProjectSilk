// client/src/components/ProductDetailsField.jsx
//
// Карточка товара для покупателя в форме продавца: описание, состав ткани в %, уход,
// страна производства. Те же правила, что на сервере (server/utils/productDetails.js):
// состав — вместе 100 % (±0,5 на округление бирки).

import React from 'react';

/** Подсказки для названия волокна; можно вписать любое. */
const FIBRES = [
  'Cotton', 'Polyester', 'Elastane', 'Viscose', 'Linen', 'Wool', 'Silk', 'Polyamide',
  'Acrylic', 'Cashmere', 'Lyocell', 'Modal', 'Leather',
];

export const EMPTY_DETAILS = { description: '', composition: [], care: '', countryOfOrigin: '' };

/** Поля формы из сохранённого товара. */
export function detailsFromProduct(p) {
  return {
    description: p?.description || '',
    composition: (p?.composition || []).map((r) => ({ fibre: r.fibre, percent: String(r.percent) })),
    care: p?.care || '',
    countryOfOrigin: p?.countryOfOrigin || '',
  };
}

const filledRows = (rows) => (rows || []).filter((r) => String(r.fibre || '').trim() || String(r.percent || '').trim());

/** Сумма процентов заполненных строк. */
export const compositionTotal = (rows) =>
  Math.round(filledRows(rows).reduce((s, r) => s + (Number(r.percent) || 0), 0) * 10) / 10;

/** Ошибка состава до отправки; null — всё в порядке. */
export function detailsProblem(details) {
  const rows = filledRows(details?.composition);
  if (!rows.length) return null;
  if (rows.some((r) => !String(r.fibre || '').trim())) return 'Each fibre in the composition needs a name.';
  if (rows.some((r) => !(Number(r.percent) > 0))) return 'Each fibre in the composition needs a share in %.';
  const total = compositionTotal(rows);
  if (Math.abs(total - 100) > 0.5) return `Fabric composition must add up to 100 % (now ${total} %).`;
  return null;
}

/** Поля в FormData — все сразу: пустое поле на сервере очищает значение. */
export function appendDetails(fd, details) {
  fd.append('description', details.description || '');
  fd.append('care', details.care || '');
  fd.append('countryOfOrigin', details.countryOfOrigin || '');
  const rows = filledRows(details.composition)
    .map((r) => ({ fibre: String(r.fibre).trim(), percent: Number(r.percent) }));
  fd.append('composition', rows.length ? JSON.stringify(rows) : '');
}

export default function ProductDetailsField({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const rows = value.composition || [];
  const setRow = (i, patch) => set({ composition: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const total = compositionTotal(rows);

  return (
    <fieldset style={styles.box}>
      <legend style={styles.legend}>Product details</legend>

      <label style={styles.label}>
        Description
        <textarea
          style={{ ...styles.input, minHeight: 90, resize: 'vertical' }}
          value={value.description}
          maxLength={4000}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="What it is, how it fits, what to wear it with"
        />
      </label>

      <div style={styles.label}>
        Fabric composition, %
        <div style={styles.rows}>
          {rows.map((r, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={styles.row}>
              <input
                aria-label={`Fibre ${i + 1}`}
                style={{ ...styles.input, flex: '1 1 160px' }}
                list="fibre-names"
                value={r.fibre}
                onChange={(e) => setRow(i, { fibre: e.target.value })}
                placeholder="e.g. Cotton"
              />
              <input
                aria-label={`Share of fibre ${i + 1}, %`}
                style={{ ...styles.input, width: 80, flex: '0 0 80px' }}
                type="number" min="0" max="100" step="0.1"
                value={r.percent}
                onChange={(e) => setRow(i, { percent: e.target.value })}
              />
              <button
                type="button"
                style={styles.remove}
                aria-label={`Remove fibre ${i + 1}`}
                onClick={() => set({ composition: rows.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <datalist id="fibre-names">{FIBRES.map((f) => <option key={f} value={f} />)}</datalist>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.btn}
              onClick={() => set({ composition: [...rows, { fibre: '', percent: '' }] })}
              disabled={rows.length >= 10}
            >
              + Add fibre
            </button>
            {rows.length > 0 && (
              <span style={{ ...styles.note, color: Math.abs(total - 100) > 0.5 ? 'var(--fit-warn)' : 'var(--fit-good)' }}>
                Total {total} %
              </span>
            )}
          </div>
        </div>
      </div>

      <label style={styles.label}>
        Care
        <input
          style={styles.input}
          value={value.care}
          maxLength={1000}
          onChange={(e) => set({ care: e.target.value })}
          placeholder="e.g. Machine wash at 30 °C, do not tumble dry"
        />
      </label>

      <label style={styles.label}>
        Country of origin
        <input
          style={styles.input}
          value={value.countryOfOrigin}
          maxLength={60}
          onChange={(e) => set({ countryOfOrigin: e.target.value })}
          placeholder="e.g. Kazakhstan"
        />
      </label>
    </fieldset>
  );
}

const styles = {
  box: { display: 'grid', gap: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 16, margin: 0, background: 'var(--surface-2)' },
  legend: { fontSize: 15, fontWeight: 600, color: 'var(--ink)', padding: '0 6px' },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)' },
  input: {
    display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6,
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-strong)',
    background: 'var(--surface)', color: 'var(--ink)', font: 'inherit',
  },
  rows: { display: 'grid', gap: 6, marginTop: 6 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  remove: { border: 'none', background: 'none', color: 'var(--fit-bad)', fontSize: 18, cursor: 'pointer', marginTop: 6 },
  btn: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, color: 'var(--ink)' },
  note: { fontSize: 13 },
};
