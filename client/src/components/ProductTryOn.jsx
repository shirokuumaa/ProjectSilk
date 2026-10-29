// client/src/components/ProductTryOn.jsx
//
// Примерка прямо на странице товара: фигура покупателя по обмерам и эта вещь
// в выбранном размере. Без перехода в гардероб. compareSize — второй размер рядом
// (S и M на одной и той же фигуре): наглядный ответ на «S или M?». three.js грузится
// лениво — только когда покупатель открыл вкладку «On my avatar».

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize, getStressMap, sizeChartOf } from '../utils/fitCalculator';
import { productGarment } from '../utils/productGarment';
import styles from './ProductTryOn.module.css';

const GlbViewer = lazy(() => import('./GlbViewer'));

export default function ProductTryOn({ product, size, compareSize = null, profile, toPublicUrl }) {
  const nav = useNavigate();
  const [back, setBack] = useState(false);   // вид сзади — обе фигуры разом

  if (!isProfileComplete(profile)) {
    return (
      <div className={styles.empty}>
        <strong>Try it on your avatar</strong>
        <span>The figure is built from four numbers: height, bust, waist, hips.</span>
        <button className={styles.btn} onClick={() => nav('/avatar/create')}>Add measurements to try it on</button>
      </div>
    );
  }

  const comparing = Boolean(compareSize && compareSize !== size);
  return (
    <div className={styles.frame}>
      <div className={comparing ? styles.pair : styles.wrap}>
        <Figure product={product} size={size} profile={profile} toPublicUrl={toPublicUrl} compact={comparing} back={back} />
        {comparing && <Figure product={product} size={compareSize} profile={profile} toPublicUrl={toPublicUrl} compact back={back} />}
      </div>
      <button type="button" className={styles.view} aria-pressed={back} onClick={() => setBack((v) => !v)}>
        {back ? 'Front view' : 'Back view'}
      </button>
    </div>
  );
}

/** Одна фигура с вещью размера size; compact — подпись короче (две фигуры рядом). */
function Figure({ product, size, profile, toPublicUrl, compact, back }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [product, size]);

  const chart = useMemo(() => sizeChartOf(product), [product]);
  const row = chart.find((r) => r.size === size) || null;
  const { garment, note } = productGarment(product, row, { broken, toPublicUrl });

  const fit = useMemo(
    () => (row ? findBestSize(profile, chart, row.size).chosen : null),
    [profile, chart, row],
  );
  const stressMap = useMemo(() => (fit ? getStressMap(fit) : null), [fit]);

  return (
    <div className={styles.wrap}>
      {garment ? (
        <Suspense fallback={<div className={styles.empty}>Loading the try-on…</div>}>
          <GlbViewer
            profile={profile}
            garments={[garment]}
            stressMap={stressMap}
            onGarmentError={() => setBroken(true)}
            height="100%"
            fill={0.9}
            back={back}
          />
        </Suspense>
      ) : (
        <div className={styles.empty}>{note}</div>
      )}
      <div className={styles.caption}>
        {compact && row ? (
          <span className={styles.sizeTag}>
            <b>{row.size}</b>
            {fit && <span className={`ui-chip ${fit.wearable ? 'ui-chip--good' : 'ui-chip--warn'}`}>{fit.wearable ? 'fits' : 'may not fit'}</span>}
          </span>
        ) : (
          <>
            {garment && (row ? `On your figure in size ${row.size}` : 'On your figure')}
            {garment && garment.template && ' · shown as a generic shape — the real item may look different'}
          </>
        )}
      </div>
      {garment && note && <div className={styles.note}>{note}</div>}
    </div>
  );
}
