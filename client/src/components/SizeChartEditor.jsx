// client/src/components/SizeChartEditor.jsx
//
// Ввод размерной сетки товара продавцом.
// Продавец измеряет изделие и выбирает, как указаны обхваты: полный обхват или
// ширина в разложенном виде (половина) — тогда сервер умножает грудь, талию и
// бёдра на 2. У каждой мерки — схема и подсказка (MeasureGuide).
//
// Использование в SellerPanel:
//   const [sizeChart, setSizeChart] = useState([]);
//   const [garmentType, setGarmentType] = useState('top');
//   <SizeChartEditor
//     value={sizeChart} onChange={setSizeChart}
//     garmentType={garmentType} onGarmentTypeChange={setGarmentType}
//   />
//
// Весь текст интерфейса — на английском, цвета — из styles/tokens.css.

import React from 'react';
import MeasureGuide, { measureHint } from './MeasureGuide';

const GARMENT_TYPES = [
  { value: 'top',       label: 'Top (T-shirt, shirt, sweater)' },
  { value: 'bottom',    label: 'Bottom (trousers, skirt, shorts)' },
  { value: 'dress',     label: 'Dress / jumpsuit' },
  { value: 'outerwear', label: 'Outerwear (jacket, coat)' },
  { value: 'shoes',     label: 'Shoes' },
  { value: 'accessory', label: 'Accessory / jewellery' },
];

// тянется ли ткань — на весь товар; проценты и смысл — utils/fitCalculator.js (STRETCH_SHARE)
const STRETCH_TYPES = [
  { value: 'none',     label: 'No stretch',     hint: 'Denim, linen, cotton poplin' },
  { value: 'slight',   label: 'Slight stretch', hint: 'Stretch denim, wovens with 2–3 % elastane' },
  { value: 'stretchy', label: 'Stretchy',       hint: 'Jersey, knits with elastane, bodycon' },
];

const FIT_TYPES = [
  { value: 'tight',   label: 'Fitted' },
  { value: 'regular', label: 'Regular' },
  { value: 'loose',   label: 'Loose / oversized' },
];

// какие обмеры нужны для каждого типа вещи
const FIELDS_BY_TYPE = {
  top:       ['chest', 'waist', 'length', 'sleeve'],
  bottom:    ['waist', 'hips', 'length'],
  dress:     ['chest', 'waist', 'hips', 'length', 'sleeve'],
  outerwear: ['chest', 'waist', 'length', 'sleeve'],
  shoes:     ['length'],
  accessory: [],
};

const FIELD_LABELS = {
  chest:  'Bust',
  waist:  'Waist',
  hips:   'Hips',
  length: 'Length',
  sleeve: 'Sleeve',
};

const GIRTH_FIELDS = ['chest', 'waist', 'hips'];

const GIRTH_MODES = [
  { value: 'circumference', label: 'Full circumference' },
  { value: 'flat',          label: 'Flat (half) width' },
];

// обхват взрослой вещи меньше этого — почти наверняка ширина в разложенном виде
const LOOKS_FLAT_CM = 60;

const PRESETS = {
  letters: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  numbers: ['40', '42', '44', '46', '48', '50'],
  shoes:   ['36', '37', '38', '39', '40', '41', '42'],
};

const emptyRow = (size) => ({
  size,
  chest: '', waist: '', hips: '', length: '', sleeve: '',
  fit: 'regular',
  stretch: 0,
});

export default function SizeChartEditor({
  value = [],
  onChange,
  garmentType = 'top',
  onGarmentTypeChange,
  stretch = 'none',
  onStretchChange = () => {},
  girthMode = 'circumference',
  onGirthModeChange = () => {},
}) {
  const fields = FIELDS_BY_TYPE[garmentType] || [];
  const flat = girthMode === 'flat';
  const hintOf = (f) => measureHint(f, { mode: girthMode, bottom: garmentType === 'bottom' });
  // похоже, что ввели ширину в разложенном виде, а выбран полный обхват
  const looksFlat = !flat && value.some((row) =>
    GIRTH_FIELDS.some((f) => fields.includes(f) && Number(row[f]) > 0 && Number(row[f]) < LOOKS_FLAT_CM));
  const isAccessory = garmentType === 'accessory';

  const updateRow = (index, patch) => {
    const next = value.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRow = () => {
    const used = value.map((r) => r.size);
    const pool = garmentType === 'shoes' ? PRESETS.shoes : PRESETS.letters;
    const nextSize = pool.find((s) => !used.includes(s)) || '';
    onChange([...value, emptyRow(nextSize)]);
  };

  const removeRow = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const applyPreset = (key) => {
    onChange(PRESETS[key].map((s) => emptyRow(s)));
  };

  // строки, у которых заполнен хотя бы один нужный обмер
  const filledCount = value.filter((row) =>
    fields.some((f) => row[f] !== '' && row[f] != null)
  ).length;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <h3 style={styles.title}>Sizes and measurements</h3>
        {!isAccessory && (
          <span style={filledCount > 0 ? styles.badgeOk : styles.badgeWarn}>
            {filledCount > 0
              ? `${filledCount} ${filledCount === 1 ? 'size' : 'sizes'} filled in`
              : 'Without measurements, size advice will not work'}
          </span>
        )}
      </div>

      <label style={styles.label}>
        Garment type
        <select
          value={garmentType}
          onChange={(e) => onGarmentTypeChange(e.target.value)}
          style={styles.select}
        >
          {GARMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {isAccessory ? (
        <p style={styles.note}>
          Accessories need no measurements — buyers get no size advice for them.
        </p>
      ) : (
        <>
          <p style={styles.note}>
            Measure the <b>garment</b>, not a body. Empty fields are simply left out of the calculation.
          </p>

          <fieldset style={styles.modes}>
            <legend style={styles.modesLegend}>Bust, waist and hips are given as</legend>
            {GIRTH_MODES.map((m) => (
              <label key={m.value} style={{ ...styles.mode, ...(girthMode === m.value ? styles.modeOn : null) }}>
                <input
                  type="radio"
                  name="girthMode"
                  value={m.value}
                  checked={girthMode === m.value}
                  onChange={() => onGirthModeChange(m.value)}
                />
                {m.label}
              </label>
            ))}
            <small style={styles.small}>
              {flat
                ? 'Many shops list the garment laid flat. We double bust, waist and hips when you save.'
                : 'The distance all the way around the garment.'}
            </small>
          </fieldset>

          <MeasureGuide fields={fields} mode={girthMode} garmentType={garmentType} />

          {value.length === 0 && (
            <div style={styles.presets}>
              <span style={styles.presetLabel}>Quick start:</span>
              <button type="button" onClick={() => applyPreset('letters')} style={styles.presetBtn}>
                XS–XXL
              </button>
              <button type="button" onClick={() => applyPreset('numbers')} style={styles.presetBtn}>
                40–50
              </button>
              {garmentType === 'shoes' && (
                <button type="button" onClick={() => applyPreset('shoes')} style={styles.presetBtn}>
                  36–42
                </button>
              )}
            </div>
          )}

          {value.length > 0 && (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Size</th>
                    {fields.map((f) => (
                      <th key={f} style={styles.th} title={hintOf(f)}>
                        {FIELD_LABELS[f]}, cm{flat && GIRTH_FIELDS.includes(f) ? ' (flat)' : ''}
                      </th>
                    ))}
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {value.map((row, i) => (
                    <tr key={i}>
                      <td style={styles.td}>
                        <input
                          value={row.size}
                          onChange={(e) => updateRow(i, { size: e.target.value })}
                          placeholder="M"
                          style={{ ...styles.input, width: 70, fontWeight: 600 }}
                        />
                      </td>
                      {fields.map((f) => (
                        <td key={f} style={styles.td}>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={row[f] ?? ''}
                            onChange={(e) => updateRow(i, { [f]: e.target.value })}
                            placeholder="—"
                            title={hintOf(f)}
                            aria-label={`${FIELD_LABELS[f]}, size ${row.size || i + 1}`}
                            style={styles.input}
                          />
                        </td>
                      ))}
                      <td style={styles.td}>
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          style={styles.removeBtn}
                          title="Remove size"
                          aria-label="Remove size"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {looksFlat && (
            <p role="status" style={styles.warn}>
              Some girths are under {LOOKS_FLAT_CM} cm — if you measured the garment laid flat,
              choose “Flat (half) width” above.
            </p>
          )}

          <button type="button" onClick={addRow} style={styles.addBtn}>
            + Add size
          </button>

          {value.length > 0 && (
            <div style={styles.fitRow}>
              <label style={styles.labelInline}>
                Cut
                <select
                  value={value[0]?.fit || 'regular'}
                  onChange={(e) => onChange(value.map((r) => ({ ...r, fit: e.target.value })))}
                  style={styles.select}
                >
                  {FIT_TYPES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>

              <label style={styles.labelInline}>
                Fabric stretch
                <select
                  value={stretch}
                  onChange={(e) => onStretchChange(e.target.value)}
                  style={styles.select}
                >
                  {STRETCH_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <small style={styles.small}>
                  {STRETCH_TYPES.find((t) => t.value === stretch)?.hint}
                </small>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Подготовка данных к отправке: числа, отброс пустых строк */
export function serializeSizeChart(rows) {
  return (rows || [])
    .filter((r) => r.size && String(r.size).trim())
    .map((r) => {
      // тянучесть ткани уходит полем товара stretch, не строками сетки
      const out = { size: String(r.size).trim(), fit: r.fit || 'regular' };
      for (const f of ['chest', 'waist', 'hips', 'length', 'sleeve']) {
        const n = Number(r[f]);
        if (r[f] !== '' && r[f] != null && Number.isFinite(n) && n > 0) out[f] = n;
      }
      return out;
    });
}

const styles = {
  wrapper: {
    border: '1px solid var(--line)', borderRadius: 12, padding: 16,
    margin: '16px 0', background: 'var(--surface-2)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' },
  badgeOk: { fontSize: 12, color: 'var(--fit-good)', background: 'var(--fit-good-bg)', padding: '4px 10px', borderRadius: 20 },
  badgeWarn: { fontSize: 12, color: 'var(--fit-warn)', background: 'var(--fit-warn-bg)', padding: '4px 10px', borderRadius: 20 },
  label: { display: 'block', marginTop: 12, fontSize: 14, fontWeight: 500 },
  labelInline: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 500 },
  select: { display: 'block', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-strong)', fontSize: 14, background: 'var(--surface)' },
  note: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '10px 0' },
  presets: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 0' },
  presetLabel: { fontSize: 13, color: 'var(--muted)' },
  presetBtn: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13 },
  tableWrap: { overflowX: 'auto', margin: '12px 0' },
  table: { borderCollapse: 'collapse', width: '100%', minWidth: 420 },
  th: { textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--muted)', padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  td: { padding: '4px 8px' },
  input: { width: 90, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line-strong)', fontSize: 14, background: 'var(--surface)' },
  removeBtn: { border: 'none', background: 'transparent', color: 'var(--fit-bad)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 6px' },
  addBtn: { padding: '8px 14px', borderRadius: 8, border: '1px dashed var(--line-strong)', background: 'var(--surface)', cursor: 'pointer', fontSize: 14 },
  fitRow: { display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' },
  small: { fontSize: 12, fontWeight: 400, color: 'var(--muted)', flexBasis: '100%' },
  modes: { display: 'flex', flexWrap: 'wrap', gap: 8, border: 0, padding: 0, margin: '10px 0' },
  modesLegend: { fontSize: 14, fontWeight: 500, marginBottom: 6, padding: 0 },
  mode: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
    border: '1px solid var(--line-strong)', background: 'var(--surface)', fontSize: 14, cursor: 'pointer',
  },
  modeOn: { borderColor: 'var(--ink)', background: 'var(--surface-3)' },
  warn: { fontSize: 13, color: 'var(--fit-warn)', background: 'var(--fit-warn-bg)', padding: '8px 10px', borderRadius: 8, margin: '8px 0' },
};
