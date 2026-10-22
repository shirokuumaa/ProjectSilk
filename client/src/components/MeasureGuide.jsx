// client/src/components/MeasureGuide.jsx
//
// «Как мерить» для формы продавца: на каждую мерку — маленькая схема (своя
// рисовка, без чужих картинок) и одна строка, что именно мерить.
// Обхваты рисуются по-разному: «flat» — прямая поперёк разложенной вещи,
// «circumference» — пунктирный эллипс вокруг.
import React from 'react';
import styles from './MeasureGuide.module.css';

// силуэт платья с рукавом: подходит и для верха, и для платья
const DRESS = 'M30 8 Q40 14 50 8 L62 14 L74 34 L66 39 L58 28 L58 46 Q56 52 58 58 L64 96 L16 96 L22 58 Q24 52 22 46 L22 28 L14 39 L6 34 L18 14 Z';
// силуэт брюк для низа
const TROUSERS = 'M22 10 L58 10 L60 30 L64 96 L46 96 L40 40 L34 96 L16 96 L20 30 Z';

// уровни замеров на схемах: y и края силуэта
const LINES = {
  dress: { chest: [31, 22, 58], waist: [48, 23, 57], hips: [64, 20, 60] },
  bottom: { waist: [12, 22, 58], hips: [28, 20, 60] },
};

const TEXT = {
  chest: {
    flat: 'Lay the garment flat and measure straight across, armpit to armpit.',
    circumference: 'Measure all the way around, just below the armholes.',
  },
  waist: {
    flat: 'Measure straight across the narrowest part (or the waistband), edge to edge.',
    circumference: 'Measure all the way around the narrowest part (or the waistband).',
  },
  hips: {
    flat: 'Measure straight across the widest part below the waist, edge to edge.',
    circumference: 'Measure all the way around the widest part below the waist.',
  },
  length: {
    top: 'From the highest point of the shoulder, next to the collar, down to the hem.',
    bottom: 'From the top of the waistband down to the hem.',
  },
  sleeve: 'From the shoulder seam to the end of the cuff.',
};

const LABELS = { chest: 'Bust', waist: 'Waist', hips: 'Hips', length: 'Length', sleeve: 'Sleeve' };

function Girth({ y, x1, x2, mode }) {
  if (mode === 'flat') {
    return (
      <g className={styles.measure}>
        <line x1={x1} y1={y} x2={x2} y2={y} />
        <line x1={x1} y1={y - 3} x2={x1} y2={y + 3} />
        <line x1={x2} y1={y - 3} x2={x2} y2={y + 3} />
      </g>
    );
  }
  return <ellipse className={`${styles.measure} ${styles.around}`} cx={(x1 + x2) / 2} cy={y} rx={(x2 - x1) / 2} ry={3} />;
}

function Diagram({ field, mode, bottom }) {
  const outline = bottom ? TROUSERS : DRESS;
  const lines = bottom ? LINES.bottom : LINES.dress;
  let mark = null;
  if (lines[field]) {
    const [y, x1, x2] = lines[field];
    mark = <Girth y={y} x1={x1} x2={x2} mode={mode} />;
  } else if (field === 'length') {
    mark = bottom
      ? <line className={styles.measure} x1="50" y1="10" x2="55" y2="96" />
      : <line className={styles.measure} x1="47" y1="10" x2="47" y2="96" />;
  } else if (field === 'sleeve') {
    mark = <line className={styles.measure} x1="61" y1="15" x2="71" y2="36" />;
  }
  return (
    <svg className={styles.svg} viewBox="0 0 80 100" role="img" aria-label={`How to measure ${LABELS[field].toLowerCase()}`}>
      <path className={styles.outline} d={outline} />
      {mark}
    </svg>
  );
}

export function measureHint(field, { mode = 'circumference', bottom = false } = {}) {
  if (field === 'length') return bottom ? TEXT.length.bottom : TEXT.length.top;
  if (field === 'sleeve') return TEXT.sleeve;
  return TEXT[field]?.[mode] || '';
}

export default function MeasureGuide({ fields = [], mode = 'circumference', garmentType = 'top' }) {
  const bottom = garmentType === 'bottom';
  const shown = fields.filter((f) => LABELS[f]);
  if (!shown.length) return null;
  return (
    <div className={styles.grid}>
      {shown.map((f) => (
        <figure key={f} className={styles.card}>
          <Diagram field={f} mode={mode} bottom={bottom} />
          <figcaption>
            <b>{LABELS[f]}</b>
            <span>{measureHint(f, { mode, bottom })}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
