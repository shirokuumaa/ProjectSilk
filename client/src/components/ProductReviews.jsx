// client/src/components/ProductReviews.jsx
//
// Отзывы на странице товара: средняя оценка, «маломерит / в размер / большемерит» долями,
// «люди с похожей фигурой брали M» (только для вошедшего с обмерами и только когда
// похожих хотя бы трое) и сами отзывы — с ростом автора и купленным размером.

import React, { useEffect, useState } from 'react';
import { FEEL_LABELS, FIT_LABELS, ZONE_LABELS, productReviews, similarFigure } from '../utils/reviewsApi';
import styles from './FitReview.module.css';

const dateOf = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function ProductReviews({ productId }) {
  const [data, setData] = useState(null);
  const [similar, setSimilar] = useState(null);

  useEffect(() => {
    let alive = true;
    productReviews(productId).then((d) => alive && setData(d)).catch(() => alive && setData({ reviews: [], summary: { count: 0 } }));
    similarFigure(productId).then((s) => alive && setSimilar(s));
    return () => { alive = false; };
  }, [productId]);

  if (!data) return null;
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const summary = data.summary || { count: 0 };
  const total = summary.count || 0;

  return (
    <section className={styles.reviews} aria-labelledby="reviews-title">
      <h2 id="reviews-title" className={styles.title}>
        Reviews{total ? ` · ${total}` : ''}
        {total > 0 && <span className={styles.avg}>★ {summary.rating.toFixed(1)}</span>}
      </h2>

      {similar?.enough && (
        <p className={styles.similar}>
          People with a figure like yours mostly kept size <b>{similar.size}</b>
          {' '}({similar.sizeCount} of {similar.count} similar buyers).
        </p>
      )}

      {total === 0 ? (
        <p className={styles.muted}>No reviews yet. Buyers can review an item after it is delivered.</p>
      ) : (
        <>
          <div className={styles.fitBar} aria-label="How the size fits">
            {Object.entries(FIT_LABELS).map(([k, label]) => {
              const n = summary.fit?.[k] || 0;
              return (
                <div key={k} className={styles.fitCol}>
                  <span>{label}</span>
                  <i><em style={{ width: `${Math.round((n / total) * 100)}%` }} /></i>
                  <span className={styles.muted}>{Math.round((n / total) * 100)}%</span>
                </div>
              );
            })}
          </div>
          <ul className={styles.list}>
            {reviews.map((r) => (
              <li key={r._id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.stars} aria-label={`Rated ${r.rating} out of 5`}>{'★'.repeat(r.rating)}<i>{'★'.repeat(5 - r.rating)}</i></span>
                  <span className={styles.muted}>{r.author} · {dateOf(r.createdAt)}</span>
                </div>
                <div className={styles.meta}>
                  {r.size && <span className="ui-chip">Bought {r.size}</span>}
                  {r.heightCm && <span className="ui-chip">Height {r.heightCm} cm</span>}
                  <span className={`ui-chip ${r.fit === 'true' ? 'ui-chip--good' : 'ui-chip--warn'}`}>{FIT_LABELS[r.fit]}</span>
                  {Object.entries(r.zones || {}).filter(([, v]) => v).map(([z, v]) => (
                    <span key={z} className="ui-chip">{ZONE_LABELS[z]}: {FEEL_LABELS[v].toLowerCase()}</span>
                  ))}
                </div>
                {r.text && <p className={styles.text}>{r.text}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
