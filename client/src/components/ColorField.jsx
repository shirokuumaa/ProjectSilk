// client/src/components/ColorField.jsx
//
// Основной цвет товара в форме продавца: снимается с фото (utils/garmentColor.js),
// продавец может поправить или убрать. В примерке вещь окрашивается в этот цвет.

import React from 'react';

const NEUTRAL = '#808080'; // значение поля, пока цвета нет: input type=color без значения не бывает

export default function ColorField({ value, onChange }) {
  return (
    <div style={styles.row}>
      <label style={styles.label}>
        Main colour
        <input
          type="color"
          value={value || NEUTRAL}
          onChange={(e) => onChange(e.target.value)}
          style={styles.swatch}
        />
      </label>
      <span style={styles.note}>
        {value
          ? 'Taken from the photo — change it if it looks wrong. The item is shown in this colour on the try-on figure.'
          : 'Not set — the try-on figure shows the item in a neutral colour.'}
      </span>
      {value && (
        <button type="button" onClick={() => onChange(null)} style={styles.clear}>Clear</button>
      )}
    </div>
  );
}

const styles = {
  row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  label: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  swatch: { width: 40, height: 28, padding: 0, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--surface)' },
  note: { fontSize: 13, color: 'var(--muted)', flex: '1 1 220px' },
  clear: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 },
};
