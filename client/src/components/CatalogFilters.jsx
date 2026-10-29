// client/src/components/CatalogFilters.jsx
//
// Полоса фильтров витрины: «Fits me» (вещи с подходящим фигуре размером), размеры,
// цена от–до, «In stock», сброс. Значения — в адресе страницы (utils/catalogFilter.js).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activeFilterCount } from '../utils/catalogFilter';
import { currencySymbol } from '../utils/money';
import styles from './CatalogFilters.module.css';

export default function CatalogFilters({ filters, sizes, hasBody, onChange, onClear }) {
  const [min, setMin] = useState(filters.min ?? '');
  const [max, setMax] = useState(filters.max ?? '');
  useEffect(() => { setMin(filters.min ?? ''); setMax(filters.max ?? ''); }, [filters.min, filters.max]);

  const toggleSize = (s) => {
    const next = filters.sizes.includes(s) ? filters.sizes.filter((x) => x !== s) : [...filters.sizes, s];
    onChange({ size: next.join(',') });
  };
  const applyPrice = (e) => {
    e.preventDefault();
    onChange({ min: min === '' ? '' : String(Math.max(0, Number(min) || 0)), max: max === '' ? '' : String(Math.max(0, Number(max) || 0)) });
  };
  const count = activeFilterCount(filters);
  const priceLabel = filters.min !== null || filters.max !== null
    ? `Price: ${filters.min ?? 0}–${filters.max ?? '…'} ${currencySymbol()}`
    : 'Price';

  return (
    <div className={styles.bar} role="group" aria-label="Filters">
      <button
        type="button"
        className={`${styles.toggle} ${filters.fitsMe ? styles.on : ''}`}
        aria-pressed={filters.fitsMe}
        disabled={!hasBody}
        onClick={() => onChange({ fits: filters.fitsMe ? '' : '1' })}
        title={hasBody ? 'Only items with a size that fits your figure' : 'Add your measurements to use this filter'}
      >
        <span className={styles.dot} aria-hidden="true" /> Fits me
      </button>
      {hasBody === false && <Link to="/avatar/create" className={styles.hint}>Add measurements to filter by fit</Link>}

      <details className={styles.drop}>
        <summary className={`${styles.toggle} ${filters.sizes.length ? styles.on : ''}`}>
          Size{filters.sizes.length ? `: ${filters.sizes.join(', ')}` : ''}
        </summary>
        <div className={styles.pop}>
          {sizes.length === 0 && <span className={styles.hint}>No sizes in this catalogue yet</span>}
          <div className={styles.sizes}>
            {sizes.map((s) => (
              <label key={s} className={`${styles.size} ${filters.sizes.includes(s) ? styles.sizeOn : ''}`}>
                <input type="checkbox" checked={filters.sizes.includes(s)} onChange={() => toggleSize(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
      </details>

      <details className={styles.drop}>
        <summary className={`${styles.toggle} ${filters.min !== null || filters.max !== null ? styles.on : ''}`}>{priceLabel}</summary>
        <form className={styles.pop} onSubmit={applyPrice}>
          <div className={styles.price}>
            <label>From<input aria-label="Minimum price" type="number" min="0" value={min} onChange={(e) => setMin(e.target.value)} /></label>
            <label>To<input aria-label="Maximum price" type="number" min="0" value={max} onChange={(e) => setMax(e.target.value)} /></label>
          </div>
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Apply</button>
        </form>
      </details>

      <button
        type="button"
        className={`${styles.toggle} ${filters.inStock ? styles.on : ''}`}
        aria-pressed={filters.inStock}
        onClick={() => onChange({ stock: filters.inStock ? '' : '1' })}
      >
        In stock
      </button>

      {count > 0 && <button type="button" className={styles.clear} onClick={onClear}>Clear filters ({count})</button>}
    </div>
  );
}
