// client/src/pages/HomePage.jsx
//
// Витрина. Гостю и покупателю без обмеров — первый экран с обещанием магазина
// («узнай свой размер до покупки») и три шага; с обмерами — строка «ваша фигура».
// Ниже — каталог: раздел (тип вещи, ?type=), поиск (?q=, из шапки), сортировка (?sort=).
// Шапка — общая для сайта (components/TopBar.jsx в App).

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import ProductCardTall from '../components/ProductCardTall';
import { SHOP_SECTIONS } from '../components/TopBar';
import { ArrowRightIcon } from '../components/Icons';
import { BRAND } from '../brand';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { garmentTypeOf } from '../utils/garmentTemplates';
import styles from './HomePage.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);

const SORTS = [
  ['new', 'Newest'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
];

/** Текст для поиска: название, описание, магазин, тип, состав. */
const haystack = (p) => [
  p.title, p.name, p.description, p.category, p.store, garmentTypeOf(p),
  ...(p.composition || []).map((c) => c.fibre),
].filter(Boolean).join(' ').toLowerCase();

export default function HomePage({ addToCart }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'new';

  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(undefined);   // undefined — ещё грузится

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/products`);
        if (!canceled) setAllProducts(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!canceled) setAllProducts([]);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve(loadBodyProfile()).then((p) => alive && setProfile(p || null)).catch(() => alive && setProfile(null));
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = allProducts.filter((p) => {
      if (type && garmentTypeOf(p) !== type) return false;
      if (!words.length) return true;
      const hay = haystack(p);
      return words.every((w) => hay.includes(w));
    });
    if (sort === 'price-asc') return [...list].sort((a, b) => (a.price || 0) - (b.price || 0));
    if (sort === 'price-desc') return [...list].sort((a, b) => (b.price || 0) - (a.price || 0));
    return list;
  }, [allProducts, q, type, sort]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  const hasBody = isProfileComplete(profile);
  const sectionLabel = SHOP_SECTIONS.find(([t]) => t === type)?.[1];
  const heading = q ? `Results for “${q}”` : sectionLabel || 'New in';
  // на первом экране — платье (если есть): вещь целиком лучше объясняет примерку
  const heroProduct = allProducts.find((p) => garmentTypeOf(p) === 'dress') || allProducts[0];
  const heroImage = heroProduct ? toPublicUrl(heroProduct.image) : null;

  return (
    <main className={styles.page}>
      {profile !== undefined && !hasBody && !q && !type && <Hero image={heroImage} />}
      {hasBody && <FigureStrip profile={profile} />}

      <section id="catalogue" className={`ui-container ${styles.catalogue}`}>
        <div className={styles.head}>
          <div>
            <h1 className={styles.title}>{heading}</h1>
            {!loading && (
              <span className={styles.count}>{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</span>
            )}
          </div>
          <label className={styles.sort}>
            Sort by
            <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'new' ? '' : e.target.value)}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.chips} role="group" aria-label="Sections">
          <button className={`${styles.chip} ${!type ? styles.chipOn : ''}`} onClick={() => setParam('type', '')}>All</button>
          {SHOP_SECTIONS.map(([t, label]) => (
            <button key={t} className={`${styles.chip} ${type === t ? styles.chipOn : ''}`} onClick={() => setParam('type', t)}>
              {label}
            </button>
          ))}
        </div>

        {loading && <p className={styles.state}>Loading products…</p>}

        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              {q ? <>Nothing found for <strong>{q}</strong></> : 'Nothing in this section yet'}
            </p>
            <button className="ui-btn" onClick={() => setParams(new URLSearchParams())}>Show everything</button>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className={styles.grid}>
            {filtered.map((product) => (
              <ProductCardTall
                key={product._id || product.id}
                product={product}
                addToCart={addToCart}
                profile={profile === undefined ? null : profile}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/** Первый экран для покупателя без обмеров: что за магазин и как он работает. */
function Hero({ image }) {
  return (
    <section className={styles.hero}>
      <div className={`ui-container ${styles.heroRow}`}>
        <div className={styles.heroText}>
          <span className="ui-eyebrow">Virtual fitting room</span>
          <h1 className={styles.heroTitle}>{BRAND.tagline}.</h1>
          <p className={styles.heroPitch}>{BRAND.pitch}</p>
          <div className={styles.heroCtas}>
            <Link to="/avatar/create" className="ui-btn ui-btn--primary ui-btn--lg">
              Create my avatar <ArrowRightIcon size={18} />
            </Link>
            <a href="#catalogue" className="ui-btn ui-btn--ghost ui-btn--lg">Browse new in</a>
          </div>
          <ol className={styles.steps}>
            <li><b>1</b><span>Add four measurements — height, bust, waist, hips</span></li>
            <li><b>2</b><span>Try items on your avatar, in every size</span></li>
            <li><b>3</b><span>Order the size that fits and keep it</span></li>
          </ol>
        </div>

        {/* иллюстрация: вещь и разбор размера по зонам — то, чего нет у обычных магазинов */}
        <div className={styles.heroVisual} aria-hidden="true">
          <div className={styles.heroPhoto}>{image && <img src={image} alt="" />}</div>
          <div className={styles.fitCard}>
            <div className={styles.fitHead}>
              <span>Your size</span>
              <b>S</b>
              <span className="ui-chip ui-chip--good">good fit</span>
            </div>
            {[['Bust', 72, 'snug'], ['Waist', 58, 'good'], ['Hips', 64, 'good']].map(([zone, w, note]) => (
              <div key={zone} className={styles.fitRow}>
                <span>{zone}</span>
                <i><em style={{ width: `${w}%` }} /></i>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Строка для покупателя с обмерами: каталог показывает размер под его фигуру. */
function FigureStrip({ profile }) {
  return (
    <div className={styles.strip}>
      <div className={`ui-container ${styles.stripRow}`}>
        <span className={styles.stripText}>
          Sizes below are picked for your figure ·{' '}
          <b>{profile.heightCm} · {profile.chest} · {profile.waist} · {profile.hips} cm</b>
        </span>
        <span className={styles.stripLinks}>
          <Link to="/avatar/create">Edit measurements</Link>
          <Link to="/wardrobe">Open fitting room →</Link>
        </span>
      </div>
    </div>
  );
}
