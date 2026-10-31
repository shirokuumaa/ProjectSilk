// client/src/components/AccessoryField.jsx
//
// Карточка аксессуара или обуви в форме продавца: вид и размеры, по которым примерка
// крепит модель к телу и масштабирует её (utils/accessoryPlacement.js).
// Показывается только у типов shoes и accessory; у обуви вид не выбирается.
//
// Под полями — правила фото (из него делается 3D-модель) и предупреждения проверки фото товара
// (utils/accessoryPhoto.js); проверка ничего не запрещает.
//
// Использование:
//   <AccessoryField garmentType={type} value={accessory} onChange={setAccessory} photo={url} />
//   value — null или { kind?, lengthCm?, widthCm?, …, size?, sizeSystem?, side?, level? } (строки из полей).
//   serializeAccessory(type, value) — что отправить на сервер (JSON-строка или '' — карточки нет).

import React, { useEffect, useState } from 'react';
import { ACCESSORY_KINDS, FIELD_LABELS } from '../utils/accessoryKinds';
import { PHOTO_TIPS, checkAccessoryPhotoUrl } from '../utils/accessoryPhoto';

const HINTS = {
  earrings: 'From the top of the hook to the lowest point.',
  necklace: 'Full chain length when closed. Pendant height is optional.',
  ring: 'The size on the tag: US (e.g. 7) or EU (inner circumference in mm, e.g. 54).',
  bracelet: 'Inner circumference when closed.',
  watch: 'Width of the case without the crown.',
  belt: 'Strap width, and the length from the buckle to the middle hole.',
  shoulder_bag: 'Bag body sizes; strap drop is from the top of the strap to the top of the bag.',
  handbag: 'Bag body sizes without the handles.',
  hat: 'Head circumference the hat is made for (e.g. 57), and the width with the brim.',
  glasses: 'Front width of the frame, hinge to hinge.',
  shoes: 'The size on the box. Buyers see if it fits their foot length.',
};

const SIDED = ['ring', 'bracelet', 'watch', 'shoulder_bag', 'handbag'];

/** Что отправить на сервер: JSON карточки или '' (у одежды и без вида — карточки нет). */
export function serializeAccessory(garmentType, value) {
  if (garmentType !== 'shoes' && garmentType !== 'accessory') return '';
  const kind = garmentType === 'shoes' ? 'shoes' : value?.kind;
  if (!ACCESSORY_KINDS[kind]) return '';
  const out = { kind };
  const fields = [...ACCESSORY_KINDS[kind].fields, ...(ACCESSORY_KINDS[kind].sizeSystems ? ['sizeSystem'] : []), 'side'];
  fields.forEach((f) => {
    const v = value?.[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[f] = String(v).trim();
  });
  return JSON.stringify(out);
}

/** Карточка для полей формы из товара с сервера. */
export function accessoryFromProduct(product) {
  return product?.accessory ? { ...product.accessory } : null;
}

const labelFor = (field, kind) => FIELD_LABELS[field][kind] || FIELD_LABELS[field].default;

export default function AccessoryField({ garmentType, value, onChange, photo = null }) {
  const shown = garmentType === 'shoes' || garmentType === 'accessory';
  const kind = garmentType === 'shoes' ? 'shoes' : value?.kind || '';
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let alive = true;
    setWarnings([]);
    if (shown && photo) checkAccessoryPhotoUrl(photo, { kind }).then((w) => { if (alive && w) setWarnings(w); });
    return () => { alive = false; };
  }, [shown, photo, kind]);

  if (!shown) return null;
  const spec = ACCESSORY_KINDS[kind];
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  return (
    <fieldset style={styles.wrapper}>
      <legend style={styles.legend}>{garmentType === 'shoes' ? 'Shoe size' : 'Accessory'}</legend>
      <p style={styles.note}>
        Buyers try it on their avatar: it is placed where it is worn and scaled to these sizes.
      </p>
      <div style={styles.row}>
        {garmentType === 'accessory' && (
          <label style={styles.label}>
            Kind
            <select value={kind} onChange={(e) => onChange({ kind: e.target.value })} style={styles.input}>
              <option value="">Choose…</option>
              {Object.entries(ACCESSORY_KINDS).filter(([k]) => k !== 'shoes').map(([k, s]) => (
                <option key={k} value={k}>{s.label}</option>
              ))}
            </select>
          </label>
        )}
        {spec?.fields.map((f) => (f === 'level' ? (
          <label key={f} style={styles.label}>
            {labelFor(f, kind)}
            <select value={value?.level || 'waist'} onChange={set('level')} style={styles.input}>
              <option value="waist">Waist</option>
              <option value="hips">Hips</option>
            </select>
          </label>
        ) : (
          <label key={f} style={styles.label}>
            {labelFor(f, kind)}
            <input
              type={f === 'size' ? 'text' : 'number'}
              inputMode="decimal"
              min="0"
              step="0.1"
              value={value?.[f] ?? ''}
              onChange={set(f)}
              style={styles.input}
            />
          </label>
        )))}
        {spec?.sizeSystems && (
          <label style={styles.label}>
            Size system
            <select value={value?.sizeSystem || spec.sizeSystems[0]} onChange={set('sizeSystem')} style={styles.input}>
              {spec.sizeSystems.map((s) => (
                <option key={s} value={s}>{s === 'US-W' ? 'US women' : s === 'US-M' ? 'US men' : s === 'cm' ? 'Foot length, cm' : s}</option>
              ))}
            </select>
          </label>
        )}
        {SIDED.includes(kind) && (
          <label style={styles.label}>
            {kind.endsWith('bag') ? 'Worn on' : 'Worn on hand'}
            <select value={value?.side || 'l'} onChange={set('side')} style={styles.input}>
              <option value="l">Left</option>
              <option value="r">Right</option>
            </select>
          </label>
        )}
      </div>
      {spec && <p style={styles.hint}>{HINTS[kind]}</p>}

      <div style={styles.tips}>
        <p style={styles.tipsTitle}>Photo tips — the 3D model is made from your product photo:</p>
        <ul style={styles.list}>
          {PHOTO_TIPS.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      {warnings.length > 0 && (
        <div role="status" style={styles.warn}>
          <p style={styles.tipsTitle}>Check your photo:</p>
          <ul style={styles.list}>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
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
  hint: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, margin: '10px 0 0' },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 500, minWidth: 140 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-strong)', fontSize: 14, background: 'var(--surface)' },
  tips: { marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 },
  tipsTitle: { margin: '0 0 4px', fontSize: 12, fontWeight: 600, color: 'var(--ink)' },
  list: { margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 },
  warn: {
    marginTop: 10, padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--fit-warn)', background: 'var(--fit-warn-bg)', color: 'var(--ink)',
  },
};
