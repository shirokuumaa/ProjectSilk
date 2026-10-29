// client/src/components/ProductCardTall.jsx
//
// Карточка товара в каталоге: фото 3:4 (при наведении — второе фото галереи), магазин,
// название, цена, «Your size S» по обмерам покупателя. При наведении — «Try on» и
// «Add to cart»: у вещи с несколькими размерами корзина сначала спрашивает размер
// (рекомендованный отмечен, распроданный — серым), с одним размером кладёт сразу.
// Звёзды — только когда у товара есть оценка: «★★★★★ 0.0» выглядит как плохая оценка.

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProductCardTall.module.css';
import { HangerIcon, HeartIcon } from './Icons';
import { addToWardrobe as addWardrobeHelper } from '../utils/wardrobeStorage';
import { findBestSize, sizeChartOf } from '../utils/fitCalculator';
import { getCachedBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { formatPrice } from '../utils/money';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);
const NO_IMAGE = 'https://dummyimage.com/600x800/FCFBFA/9A9AA2&text=%20';

export default function ProductCardTall({ product, addToCart, onAvatar, profile }) {
  const {
    id, _id, title, name, price, rating = 0, image, images = [], category, badge, discount,
  } = product || {};
  const sku = id || _id;
  const nav = useNavigate();
  const displayName = name || title || 'Item';

  const main = toPublicUrl(image) || NO_IMAGE;
  const second = images?.[0] ? toPublicUrl(images[0]) : null;

  // ── размер покупателя: обмеры со страницы (один запрос на каталог) или из кэша браузера ──
  const body = profile !== undefined ? profile : getCachedBodyProfile();
  const chart = useMemo(() => sizeChartOf(product), [product]);
  const fit = useMemo(
    () => (isProfileComplete(body) && chart.length ? findBestSize(body, chart).recommended : null),
    [body, chart],
  );
  const rows = product?.sizeChart || [];
  const soldOut = rows.length > 0 && rows.every((r) => r.stock === 0);

  // ── избранное ──
  const [fav, setFav] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('favorites') || '[]').some((x) => (x.id || x._id) === sku);
    } catch { return false; }
  });
  const toggleFav = (e) => {
    e.stopPropagation();
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch {}
    arr = fav
      ? arr.filter((x) => (x.id || x._id) !== sku)
      : [...arr, { id: sku, _id: sku, name: displayName, price: price || 0, image: main, category }];
    localStorage.setItem('favorites', JSON.stringify(arr));
    setFav(!fav);
  };

  // ── корзина: размер выбирают здесь же ──
  const [picking, setPicking] = useState(false);
  const [added, setAdded] = useState(null);   // размер, который только что добавили
  const add = (size) => {
    setPicking(false);
    if (typeof addToCart !== 'function') return nav('/cart');
    const ok = addToCart({
      id: sku, _id: sku, name: displayName, price: price || 0, image: main, category,
      currency: product?.currency, quantity: 1, size: size || null,
    });
    if (ok === false) return;
    setAdded(size || '');
    setTimeout(() => setAdded(null), 1400);
  };
  const handleAdd = (e) => {
    e.stopPropagation();
    if (rows.length > 1) return setPicking((v) => !v);
    add(rows[0]?.size || null);
  };

  const handleAvatar = (e) => {
    e.stopPropagation();
    if (typeof onAvatar === 'function') onAvatar(product);
    else nav(`/tryon/avatar?sku=${encodeURIComponent(sku || '')}`);
  };
  const handleWardrobe = (e) => {
    e.stopPropagation();
    addWardrobeHelper({ ...product, id: sku, image: main });
  };

  const badgeText = soldOut ? 'Sold out' : badge ? String(badge) : discount ? `−${Number(discount)}%` : null;
  const ratingValue = Number(rating) || 0;
  const reviewCount = product?.reviewCount ?? product?.numReviews;
  const hasRating = ratingValue > 0 && (reviewCount == null || Number(reviewCount) > 0);
  const open = () => sku && nav(`/product/${encodeURIComponent(sku)}`);

  return (
    <article
      className={`${styles.card} ${picking ? styles.picking : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
      onMouseLeave={() => setPicking(false)}
      aria-label={displayName}
    >
      <div className={styles.media}>
        <img className={styles.image} src={main} alt={displayName} loading="lazy"
          onError={(e) => { e.currentTarget.src = NO_IMAGE; }} />
        {second && <img className={`${styles.image} ${styles.imageAlt}`} src={second} alt="" loading="lazy" />}

        {badgeText && <span className={`${styles.badge} ${soldOut ? styles.badgeOut : ''}`}>{badgeText}</span>}

        <div className={styles.corner}>
          <button className={`${styles.round} ${fav ? styles.roundOn : ''}`} onClick={toggleFav}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}>
            <HeartIcon size={18} filled={fav} />
          </button>
          <button className={styles.round} onClick={handleWardrobe} aria-label="Save to wardrobe" title="Save to the fitting room">
            <HangerIcon size={18} />
          </button>
        </div>

        <div className={styles.overlay} onClick={(e) => e.stopPropagation()}>
          {picking ? (
            <div className={styles.sizes} role="group" aria-label="Choose a size">
              {rows.map((r) => (
                <button
                  key={r.size}
                  className={`${styles.size} ${fit?.size === r.size ? styles.sizeRec : ''}`}
                  disabled={r.stock === 0}
                  onClick={() => add(r.size)}
                  aria-label={`Add size ${r.size} to cart${r.stock === 0 ? ' (out of stock)' : ''}`}
                >
                  {r.size}
                </button>
              ))}
            </div>
          ) : (
            <>
              <button className={styles.overlayBtn} onClick={handleAvatar} title="Try on my avatar">Try on</button>
              <button className={`${styles.overlayBtn} ${styles.overlayDark}`} onClick={handleAdd} disabled={soldOut}>
                {added !== null ? `Added${added ? ` · ${added}` : ''} ✓` : 'Add to cart'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {product?.store && <div className={styles.store}>{product.store}</div>}
        <div className={styles.name} title={displayName}>{displayName}</div>
        {hasRating && (
          <div className={styles.rating} aria-label={`Rated ${ratingValue.toFixed(1)} out of 5`}>
            {'★★★★★'} <i className={styles.ratingNum}>{ratingValue.toFixed(1)}</i>
          </div>
        )}
        <div className={styles.priceRow}>
          <span className={styles.price}>{formatPrice(price, product?.currency)}</span>
          {fit && (
            <span className={`ui-chip ${fit.wearable ? 'ui-chip--good' : 'ui-chip--warn'}`}>
              {fit.wearable ? `Your size ${fit.size}` : `Closest ${fit.size}`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
