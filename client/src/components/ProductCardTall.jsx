// client/src/components/ProductCardTall.jsx
//
// Карточка товара по макету projectsilk_v11.html.
//
// Отличия от прошлой версии — все три из макета:
//   1. Строка-подсказка про 3D: «Перетащите на аватар» или «Нет 3D-модели».
//      В макете она есть, и это не украшение: покупатель сразу видит,
//      можно ли примерить вещь, не нажимая ничего.
//   2. Цена: число крупно, валюта — маленькой строкой под ним.
//      Так ряд с кнопками не разъезжается и цена не переносится.
//   3. Кнопка корзины — отдельной строкой во всю ширину и с подписью
//      «Add to cart»: значок 🛒 в части браузеров не рисуется, и кнопка
//      выглядела пустой; три подписи в один ряд в 228 пикселей не помещаются.
//
// Звёзды — только когда у товара есть оценка: «★★★★★ 0.0» у товара без
// отзывов выглядит как плохая оценка.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProductCardTall.module.css';
import SizeAdvisor from './SizeAdvisor';
import { addToWardrobe as addWardrobeHelper } from '../utils/wardrobeStorage';
import { sizeChartOf } from '../utils/fitCalculator';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);
const NO_IMAGE = 'https://dummyimage.com/600x800/FCFBFA/9A9AA2&text=%20';

export default function ProductCardTall({ product, addToCart, onAvatar }) {
  const {
    id, _id, title, name, price, rating = 0,
    image, images = [], gallery = [],
    category, badge, discount, model3d,
  } = product || {};

  const sku = id || _id;
  const nav = useNavigate();
  const has3d = Boolean(model3d);

  // ── галерея ──
  const slides = useMemo(() => {
    const raw = images?.length ? images : gallery?.length ? gallery : image ? [image] : [];
    const arr = (raw || []).filter(Boolean).map(toPublicUrl);
    return arr.length ? arr : [NO_IMAGE];
  }, [image, images, gallery]);

  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

  const startSlide = () => {
    if (slides.length <= 1 || timerRef.current) return;
    timerRef.current = setInterval(() => setIndex((p) => (p + 1) % slides.length), 1200);
  };
  const stopSlide = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    setIndex(0);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  useEffect(() => {
    slides.slice(0, 3).forEach((src) => { const img = new Image(); img.src = src; });
  }, [slides]);

  // ── избранное ──
  const [fav, setFav] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('favorites') || '[]')
        .some((x) => (x.id || x._id) === sku);
    } catch { return false; }
  });

  const toggleFav = (e) => {
    e.stopPropagation();
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch {}
    if (fav) {
      arr = arr.filter((x) => (x.id || x._id) !== sku);
    } else {
      arr.push({ id: sku, _id: sku, name: name || title || 'Item', price: price || 0, image: slides[0], category });
    }
    localStorage.setItem('favorites', JSON.stringify(arr));
    setFav(!fav);
  };

  // ── корзина ──
  const [added, setAdded] = useState(false);
  const handleAdd = (e) => {
    e.stopPropagation();
    if (typeof addToCart === 'function') {
      addToCart({
        id: sku, _id: sku,
        name: name || title || 'Item',
        price: price || 0,
        image: slides[0], category, quantity: 1,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 900);
    } else {
      nav('/cart');
    }
  };

  const handleAvatar = (e) => {
    e.stopPropagation();
    if (typeof onAvatar === 'function') onAvatar(product);
    else nav(`/tryon/avatar?sku=${encodeURIComponent(sku || '')}`);
  };

  const handleWardrobe = (e) => {
    e.stopPropagation();
    addWardrobeHelper(product);
  };

  const badgeText = badge ? String(badge) : discount ? `−${Number(discount)}%` : null;
  const ratingValue = Number(rating) || 0;
  // число отзывов, если сервер его отдаёт; иначе — есть ли вообще оценка
  const reviewCount = product?.reviewCount ?? product?.numReviews;
  const hasRating = ratingValue > 0 && (reviewCount == null || Number(reviewCount) > 0);
  const displayName = name || title || 'Item';

  return (
    <article
      className={styles.card}
      draggable
      onDragStart={(e) => {
        // Панель фигуры на главной принимает вещь и сразу считает размер,
        // поэтому кладём в перетаскивание всё нужное — без запроса к серверу.
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/json', JSON.stringify({
          id: sku,
          _id: sku,
          name: displayName,
          price: price || 0,
          image: slides[0],
          category,
          model3d: model3d || '',
          garmentType: product?.garmentType || null, // без типа — не «верх»
          sizeChart: sizeChartOf(product), // с тянучестью ткани — панель считает размер сама
        }));
      }}
      onMouseEnter={startSlide}
      onMouseLeave={stopSlide}
      role="button"
      tabIndex={0}
      onClick={() => sku && nav(`/product/${encodeURIComponent(sku)}`)}
      onKeyDown={(e) => e.key === 'Enter' && sku && nav(`/product/${encodeURIComponent(sku)}`)}
      aria-label={displayName}
    >
      <div className={styles.media}>
        {badgeText && <span className={styles.badge}>{badgeText}</span>}

        <img
          key={slides[index]}
          className={`${styles.image} ${styles.fadeIn}`}
          src={slides[index]}
          alt={displayName}
          onError={(e) => { e.currentTarget.src = NO_IMAGE; }}
        />

        <button
          className={`${styles.heart} ${fav ? styles.heartOn : ''}`}
          onClick={toggleFav}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
        >
          ♥
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.name} title={displayName}>{displayName}</div>

        {hasRating && (
          <div className={styles.rating} aria-label={`Rated ${ratingValue.toFixed(1)} out of 5`}>
            {'★★★★★'} <i className={styles.ratingNum}>{ratingValue.toFixed(1)}</i>
          </div>
        )}

        <div className={`${styles.dragHint} ${has3d ? '' : styles.dragHintNo}`}>
          {has3d ? 'Drag onto your avatar' : 'No 3D model yet'}
        </div>

        <div onClick={(e) => e.stopPropagation()}>
          <SizeAdvisor product={product} mode="compact" />
        </div>

        <div className={styles.priceRow}>
          <span className={styles.price}>{formatNumber(price)}</span>
          <span className={styles.priceUnit}>₸</span>
        </div>

        <div className={styles.actions}>
          <button className={styles.pillBtn} onClick={handleWardrobe} title="Save to wardrobe">
            Wardrobe
          </button>
          <button className={styles.pillBtn} onClick={handleAvatar} title="Try on my avatar">
            Try on
          </button>
        </div>
        <button className={styles.cartBtn} onClick={handleAdd}>
          {added ? 'Added ✓' : 'Add to cart'}
        </button>
      </div>
    </article>
  );
}

function formatNumber(v) {
  const n = Number(v || 0);
  return Number.isNaN(n) ? '—' : n.toLocaleString('en-US');
}
