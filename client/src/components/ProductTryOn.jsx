// client/src/components/ProductTryOn.jsx
//
// Примерка прямо на странице товара: фигура покупателя по обмерам и эта вещь
// в выбранном размере. Без перехода в гардероб. three.js грузится лениво — только
// когда покупатель открыл вкладку «On my avatar».

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize, getStressMap, sizeChartOf } from '../utils/fitCalculator';
import { productGarment } from '../utils/productGarment';
import styles from './ProductTryOn.module.css';

const GlbViewer = lazy(() => import('./GlbViewer'));

export default function ProductTryOn({ product, size, profile, toPublicUrl }) {
  const nav = useNavigate();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [product, size]);

  const chart = useMemo(() => sizeChartOf(product), [product]);
  const row = chart.find((r) => r.size === size) || null;
  const { garment, note } = productGarment(product, row, { broken, toPublicUrl });

  const stressMap = useMemo(() => {
    if (!row || !isProfileComplete(profile)) return null;
    const fit = findBestSize(profile, chart, row.size);
    return fit.chosen ? getStressMap(fit.chosen) : null;
  }, [profile, chart, row]);

  if (!isProfileComplete(profile)) {
    return (
      <div className={styles.empty}>
        <strong>Try it on your avatar</strong>
        <span>The figure is built from four numbers: height, bust, waist, hips.</span>
        <button className={styles.btn} onClick={() => nav('/avatar/create')}>Add measurements to try it on</button>
      </div>
    );
  }

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
          />
        </Suspense>
      ) : (
        <div className={styles.empty}>{note}</div>
      )}
      <div className={styles.caption}>
        {garment && (row ? `On your figure in size ${row.size}` : 'On your figure')}
        {garment && garment.template && ' · shown as a generic shape — the real item may look different'}
      </div>
      {garment && note && <div className={styles.note}>{note}</div>}
    </div>
  );
}
