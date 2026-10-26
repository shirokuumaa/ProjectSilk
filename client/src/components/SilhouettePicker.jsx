// client/src/components/SilhouettePicker.jsx
//
// Выбор фасона продавцом: картинки наших шаблонов своего типа (utils/silhouettes.js),
// рукав и длина. По силуэту и сетке сервер строит выкройку каждого размера.
// Для типов без шаблонов (верхняя одежда, обувь, аксессуары) ничего не показывает.
//
// Использование:
//   <SilhouettePicker garmentType={type} value={silhouette} onChange={setSilhouette} />
//   value — null («None of these») или { template, sleeve?, length }.

import React from 'react';
import {
  LENGTHS, SLEEVES, hasSleeve, silhouetteImage, silhouetteWith, silhouettesFor,
} from '../utils/silhouettes';

export default function SilhouettePicker({ garmentType, value, onChange }) {
  const options = silhouettesFor(garmentType);
  if (!options.length) return null;

  const knob = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  return (
    <fieldset style={styles.wrapper}>
      <legend style={styles.legend}>Silhouette</legend>
      <p style={styles.note}>
        Pick the closest shape. We draft a sewing pattern for every size in your size chart,
        so buyers can try the item on.
        {garmentType === 'bottom' && ' Only skirts for now — for trousers and shorts choose “None of these”.'}
      </p>

      <div style={styles.grid}>
        {options.map((s) => {
          const on = value?.template === s.template;
          return (
            <button
              key={s.template}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(silhouetteWith(garmentType, s.template))}
              style={{ ...styles.card, ...(on ? styles.cardOn : null) }}
            >
              <img src={silhouetteImage(s.template)} alt="" style={styles.img} />
              <span style={styles.cardLabel}>{s.label}</span>
              <span style={styles.cardHint}>{s.hint}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange(null)}
          style={{ ...styles.card, ...styles.none, ...(!value ? styles.cardOn : null) }}
        >
          <span style={styles.cardLabel}>None of these</span>
          <span style={styles.cardHint}>Buyers can still check their size</span>
        </button>
      </div>

      {value && (
        <div style={styles.knobs}>
          {hasSleeve(garmentType) && (
            <label style={styles.label}>
              Sleeve
              <select value={value.sleeve} onChange={knob('sleeve')} style={styles.select}>
                {SLEEVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <label style={styles.label}>
            Length
            <select value={value.length} onChange={knob('length')} style={styles.select}>
              {LENGTHS[garmentType].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}

const styles = {
  wrapper: {
    border: '1px solid var(--line)', borderRadius: 12, padding: 16,
    margin: '16px 0', background: 'var(--surface-2)',
  },
  legend: { fontSize: 16, fontWeight: 600, color: 'var(--ink)', padding: '0 4px' },
  note: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 },
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8,
    borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--surface)',
    cursor: 'pointer', textAlign: 'center',
  },
  cardOn: { borderColor: 'var(--accent)', background: 'var(--accent-soft)', boxShadow: '0 0 0 1px var(--accent)' },
  none: { justifyContent: 'center' },
  img: { width: '100%', maxWidth: 120, aspectRatio: '240 / 310', objectFit: 'contain' },
  cardLabel: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' },
  cardHint: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 },
  knobs: { display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 500 },
  select: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-strong)', fontSize: 14, background: 'var(--surface)' },
};
