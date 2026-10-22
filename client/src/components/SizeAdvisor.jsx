// client/src/components/SizeAdvisor.jsx
//
// Size verdict: the customer's measurements against the garment's.
//   compact — one chip for a product card (the green .szc line in the mock)
//   full    — size picker plus a breakdown per measurement
//
// Rewritten for the v11 look: styles moved out of inline objects into a CSS
// module built on the design tokens, so this component changes colour with
// the rest of the site instead of carrying its own palette.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findBestSize, MEASUREMENT_LABELS, sizeChartOf, STRETCH_NOTES } from '../utils/fitCalculator';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import styles from './SizeAdvisor.module.css';

export default function SizeAdvisor({
  product,
  mode = 'compact',
  onSizeChange,
  initialSize = null,
}) {
  const nav = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState(initialSize);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) { setProfile(p); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  // строки сетки с тянучестью ткани товара — её учитывает подбор размера
  const sizeChart = sizeChartOf(product);

  if (product?.garmentType === 'accessory') return null;

  if (!sizeChart.length) {
    return mode === 'compact' ? null : (
      <div className={styles.box}>
        <span className={styles.muted}>
          The seller did not enter measurements for this item
        </span>
      </div>
    );
  }

  if (loading) {
    return mode === 'compact' ? null : (
      <div className={styles.box}>
        <span className={styles.muted}>Loading your measurements…</span>
      </div>
    );
  }

  if (!isProfileComplete(profile)) {
    return (
      <div className={mode === 'compact' ? styles.compact : styles.box}>
        <span className={styles.muted}>
          {mode === 'compact'
            ? 'Add measurements'
            : 'Add your measurements to see whether this size fits'}
        </span>
        <button
          className={styles.linkBtn}
          onClick={(e) => { e.stopPropagation(); nav('/avatar/create'); }}
        >
          {mode === 'compact' ? 'add' : 'Add your measurements'}
        </button>
      </div>
    );
  }

  const result = findBestSize(profile, sizeChart, chosen);

  const pickSize = (size) => {
    const next = size === chosen ? null : size;
    setChosen(next);
    if (typeof onSizeChange === 'function') onSizeChange(next);
  };

  // ── compact: one chip on the card ──
  if (mode === 'compact') {
    const rec = result.recommended;
    if (!rec) return null;

    return (
      <div
        className={`${styles.szc} ${rec.wearable ? '' : styles.szcWarn}`}
        title={result.message}
      >
        {rec.wearable
          ? <>Your size: <b>{rec.size}</b></>
          : <>May not fit — closest is <b>{rec.size}</b></>}
      </div>
    );
  }

  // ── full ──
  const detail = result.chosen || result.recommended;

  return (
    <div className={styles.box}>
      <div className={styles.header}>Size</div>

      <div className={styles.sizeRow}>
        {result.all.map((r) => (
          <button
            key={r.size}
            onClick={() => pickSize(r.size)}
            className={[
              styles.sizeBtn,
              r.size === chosen ? styles.sizeBtnOn : '',
              r.wearable ? '' : styles.sizeBtnDim,
            ].join(' ')}
            title={r.text}
          >
            {r.size}
            {r.size === result.recommended?.size && (
              <span className={styles.recDot} title="Recommended">●</span>
            )}
          </button>
        ))}
      </div>

      <div className={`${styles.verdict} ${result.shouldWarn ? styles.verdictWarn : ''}`}>
        {result.message}
      </div>

      {STRETCH_NOTES[product?.stretch] && (
        <div className={styles.stretchNote}>{STRETCH_NOTES[product.stretch]}</div>
      )}

      {detail && (
        <table className={styles.table}>
          <tbody>
            {Object.entries(detail.parts).map(([key, part]) => (
              <tr key={key}>
                <td className={styles.tdLabel}>{MEASUREMENT_LABELS[key] || key}</td>
                <td className={styles.tdBar}>
                  <span className={styles.dot} style={{ background: part.color }} />
                  <span style={{ color: part.color, fontWeight: 500 }}>{part.text}</span>
                </td>
                <td className={styles.tdEase}>
                  {part.ease > 0 ? `+${part.ease}` : part.ease} cm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.footnote}>
        Based on your measurements: bust {profile.chest}, waist {profile.waist}, hips {profile.hips} cm.
        <button className={styles.linkBtn} onClick={() => nav('/avatar/create')}>edit</button>
      </div>
    </div>
  );
}