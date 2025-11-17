// client/src/components/ProductCardTall.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProductCardTall.module.css';

import { addToWardrobe as addWardrobeHelper } from '../utils/wardrobeStorage';

// API base → to absolute URL for /uploads
const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (s.startsWith('/uploads') ? `${API_BASE}${s}` : s);

export default function ProductCardTall({ product, addToCart, onAvatar }) {
  const {
    id, _id, title, name, price,
    rating = 0, image, images = [], gallery = [],
    category, badge, discount
  } = product || {};

  const sku = id || _id;
  const nav = useNavigate();

  // slides
  const slides = useMemo(() => {
    const raw = images?.length ? images : (gallery?.length ? gallery : (image ? [image] : []));
    const arr = (raw || []).filter(Boolean).map(toPublicUrl);
    return arr.length ? arr : ['https://dummyimage.com/600x800/f3f4f6/9ca3af&text=No+image'];
  }, [image, images, gallery]);

  // hover slideshow
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);
  const startSlide = () => {
    if (slides.length <= 1 || timerRef.current) return;
    timerRef.current = setInterval(() => setIndex(p => (p + 1) % slides.length), 1200);
  };
  const stopSlide = () => { clearInterval(timerRef.current); timerRef.current = null; setIndex(0); };

  // preload first few
  useEffect(() => {
    slides.slice(0, 3).forEach(src => { const img = new Image(); img.src = src; });
  }, [slides]);

  // favorites (heart)
  const [fav, setFav] = useState(() => {
    const raw = localStorage.getItem('favorites') || '[]';
    try { return JSON.parse(raw).some(x => (x.id || x._id) === sku); } catch { return false; }
  });
  const toggleFav = (e) => {
    e.stopPropagation();
    const raw = localStorage.getItem('favorites') || '[]';
    let arr = [];
    try { arr = JSON.parse(raw); } catch {}
    if (fav) arr = arr.filter(x => (x.id || x._id) !== sku);
    else arr.push({ id: sku, _id: sku, name: name || title || 'Product', price: price || 0, image: slides[0], category });
    localStorage.setItem('favorites', JSON.stringify(arr));
    setFav(!fav);
  };

  // cart
  const [added, setAdded] = useState(false);
  const handleAdd = (e) => {
    e.stopPropagation();
    if (typeof addToCart === 'function') {
      addToCart({ id: sku, _id: sku, name: name || title || 'Product', price: price || 0, image: slides[0], category, quantity: 1 });
      setAdded(true);
      setTimeout(() => setAdded(false), 900);
    } else {
      nav('/cart');
    }
  };

  // avatar try-on
  const handleAvatar = (e) => {
    e.stopPropagation();
    if (typeof onAvatar === 'function') onAvatar(product);
    else nav(`/tryon/avatar?sku=${encodeURIComponent(sku || '')}`);
  };

  const badgeText = badge ? String(badge) : (discount ? `-${Number(discount)}%` : null);

  return (
    <article
      className={styles.card}
      onMouseEnter={startSlide}
      onMouseLeave={stopSlide}
      role="button"
      tabIndex={0}
      onClick={() => nav(`/all-products`)}
      onKeyDown={(e) => e.key === 'Enter' && nav(`/all-products`)}
      aria-label={(name || title || 'Product') + ' card'}
    >
      <div className={styles.media}>
        {badgeText && <span className={styles.badge}>{badgeText}</span>}

        <img
          key={slides[index]}
          className={`${styles.image} ${styles.fadeIn || ''}`}
          src={slides[index]}
          alt={name || title || 'Product image'}
          onError={(e) => { e.currentTarget.src = 'https://dummyimage.com/600x800/f3f4f6/9ca3af&text=No+image'; }}
        />

        <button
          className={`${styles.heart} ${fav ? styles.heartOn : ''}`}
          onClick={toggleFav}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          title={fav ? 'In favorites' : 'Add to favorites'}
        >
          ♥️
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.name} title={name || title}>{name || title || 'Product name'}</div>

        <div className={styles.rating} aria-label={`Rating ${rating} of 5`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={i < Math.round(rating) ? styles.starOn : styles.starOff}>★</span>
          ))}
          <span className={styles.ratingNum}>{Number(rating || 0).toFixed(1)}</span>
        </div>

        <div className={styles.footerRow}>
          <div className={styles.price}>{formatPrice(price)}</div>

          <div className={styles.actions}>
            {/* NEW: Add to Wardrobe (local-first) */}
            <button
              className={styles.pillBtn}
              onClick={(e) => {
                e.stopPropagation();
                const rec = addWardrobeHelper(product);
                alert(`Added to Wardrobe: ${rec.name}`);
              }}
              title="Save to wardrobe"
            >
              👗 Add
            </button>

            <button className={styles.pillBtn} onClick={handleAvatar} title="Avatar try-on">🧍 Avatar</button>

            <button className={`${styles.pillBtn} ${styles.cartBtn}`} onClick={handleAdd} title="Add to cart">
              🛒 Cart {added && <span className={styles.tick}>✓</span>}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function formatPrice(v) {
  const n = Number(v || 0);
  if (Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-US')} ₸`;
}