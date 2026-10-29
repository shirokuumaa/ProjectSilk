// client/src/pages/ProductPage.jsx
//
// Страница товара /product/:id: галерея фото и примерка на аватаре прямо на странице,
// название, цена, выбор размера (рекомендованный выбран заранее, нет в наличии — серым),
// разбор размера (SizeAdvisor, mode="full"), описание, состав, уход, страна,
// размерная сетка продавца. В корзину — выбранный размер.
// Весь текст интерфейса — на английском, цвета — из styles/tokens.css.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SizeAdvisor from '../components/SizeAdvisor';
import SizePicker from '../components/SizePicker';
import ProductTryOn from '../components/ProductTryOn';
import ProductReviews from '../components/ProductReviews';
import { addToWardrobe } from '../utils/wardrobeStorage';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize, sizeChartOf } from '../utils/fitCalculator';
import { garmentTypeOf, offFigureReason } from '../utils/garmentTemplates';
import { formatPrice } from '../utils/money';
import styles from './ProductPage.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (String(s).startsWith('/uploads') ? `${API_BASE}${s}` : s);

// столбцы таблицы размеров — в том же порядке и с теми же подписями, что у продавца
const CHART_FIELDS = [
  ['chest', 'Bust'],
  ['waist', 'Waist'],
  ['hips', 'Hips'],
  ['length', 'Length'],
  ['sleeve', 'Sleeve'],
  ['shoulder', 'Shoulders'],
];
const FIT_LABELS = { tight: 'Fitted', regular: 'Regular', loose: 'Loose / oversized' };

/** Нет в наличии: продавец указал остаток 0. Остаток не указан — размер есть. */
const soldOut = (row) => row?.stock === 0;

export default function ProductPage({ addToCart }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [product, setProduct] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | error
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [picked, setPicked] = useState(null);   // размер, выбранный покупателем
  const [view, setView] = useState('photos');   // photos | avatar
  const [photo, setPhoto] = useState(0);
  const [compare, setCompare] = useState('');   // второй размер рядом на аватаре

  useEffect(() => {
    let alive = true;
    setState('loading');
    setPicked(null);
    setPhoto(0);
    setView('photos');
    setCompare('');
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/products/${encodeURIComponent(id)}`);
        if (!alive) return;
        if (r.status === 404) return setState('missing');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setProduct(await r.json());
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    Promise.resolve(loadBodyProfile()).then((p) => { if (alive) setProfile(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const chart = useMemo(() => product?.sizeChart || [], [product]);
  const columns = useMemo(
    () => CHART_FIELDS.filter(([key]) => chart.some((row) => Number(row[key]) > 0)),
    [chart],
  );

  // рекомендованный по обмерам — выбран заранее, если он в наличии
  const recommended = useMemo(() => {
    if (!product || !isProfileComplete(profile)) return null;
    const rows = sizeChartOf(product);
    return rows.length ? findBestSize(profile, rows).recommended?.size || null : null;
  }, [product, profile]);
  const recommendedOut = Boolean(recommended) && soldOut(chart.find((r) => r.size === recommended));
  const size = picked ?? (recommended && !recommendedOut ? recommended : null);

  if (state === 'loading') {
    return <main className={styles.page}><p className={styles.muted}>Loading the product…</p></main>;
  }
  if (state === 'missing' || state === 'error') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>
          {state === 'missing' ? 'Product not found' : 'Could not load the product'}
        </h1>
        <p className={styles.muted}>
          {state === 'missing'
            ? 'It may have been removed by the seller.'
            : 'Please check your connection and try again.'}
        </p>
        <Link className={styles.back} to="/">← Back to the shop</Link>
      </main>
    );
  }

  const sku = product._id || product.id;
  const displayName = product.name || product.title || 'Item';
  const photos = [product.image, ...(product.images || [])].filter(Boolean).map(toPublicUrl);
  const image = photos[0];
  const canTryOn = !offFigureReason({ ...product, name: displayName, garmentType: garmentTypeOf(product) });
  const allSoldOut = chart.length > 0 && chart.every(soldOut);

  const flash = (text) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 2500);
  };

  const pickSize = (s) => {
    setPicked(s);
    setError('');
  };

  const handleWardrobe = () => {
    addToWardrobe({ ...product, id: sku, image });
    flash('Saved to your wardrobe');
  };

  const handleCart = () => {
    if (typeof addToCart !== 'function') return nav('/cart');
    // у вещи с сеткой без размера в корзину не кладём — потом не понять, какой отправлять
    if (chart.length && !size) return setError('Please choose a size.');
    const ok = addToCart({
      id: sku, _id: sku, name: displayName, price: product.price || 0,
      image, category: product.category, quantity: 1, size,
    });
    if (ok !== false) flash(size ? `Added to cart · size ${size}` : 'Added to cart');
  };

  const composition = (product.composition || []).map((c) => `${c.percent}% ${c.fibre}`).join(' · ');

  return (
    <main className={styles.page}>
      <Link className={styles.back} to="/">← Back to the shop</Link>

      <div className={styles.layout}>
        <div>
          <div className={styles.tabs} role="tablist" aria-label="Product view">
            <button
              role="tab"
              aria-selected={view === 'photos'}
              className={`${styles.tab} ${view === 'photos' ? styles.tabOn : ''}`}
              onClick={() => setView('photos')}
            >
              Photos
            </button>
            <button
              role="tab"
              aria-selected={view === 'avatar'}
              className={`${styles.tab} ${view === 'avatar' ? styles.tabOn : ''}`}
              onClick={() => setView('avatar')}
            >
              On my avatar
            </button>
          </div>

          <div className={styles.media}>
            {view === 'photos' ? (
              <img className={styles.image} src={photos[photo] || image} alt={displayName} />
            ) : (
              <ProductTryOn product={product} size={size} compareSize={compare || null} profile={profile} toPublicUrl={toPublicUrl} />
            )}
          </div>

          {/* «S или M?» — второй размер рядом на той же фигуре */}
          {view === 'avatar' && canTryOn && isProfileComplete(profile) && chart.length > 1 && (
            <label className={styles.compare}>
              Compare with
              <select value={compare} onChange={(e) => setCompare(e.target.value)}>
                <option value="">— one size —</option>
                {chart.filter((r) => r.size !== size).map((r) => <option key={r.size} value={r.size}>Size {r.size}</option>)}
              </select>
            </label>
          )}

          {view === 'photos' && photos.length > 1 && (
            <div className={styles.thumbs}>
              {photos.map((src, i) => (
                <button
                  key={src}
                  className={`${styles.thumb} ${i === photo ? styles.thumbOn : ''}`}
                  aria-label={`Photo ${i + 1} of ${photos.length}`}
                  aria-pressed={i === photo}
                  onClick={() => setPhoto(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <section className={styles.info}>
          {product.store && <div className="ui-eyebrow">{product.store}</div>}
          <h1 className={styles.title}>{displayName}</h1>
          <div className={styles.price}>{formatPrice(product.price || 0, product.currency)}</div>

          <SizePicker rows={chart} value={size} recommended={recommended} onChange={pickSize} />
          {recommendedOut && !picked && (
            <p className={styles.hint}>Your size {recommended} is out of stock.</p>
          )}
          {allSoldOut && <p className={styles.hint}>This item is out of stock in every size.</p>}

          <SizeAdvisor product={product} mode="full" selectedSize={size} />

          <div className={styles.actions}>
            <button className={styles.btnDark} onClick={handleCart} disabled={allSoldOut}>
              {size ? `Add to cart · ${size}` : 'Add to cart'}
            </button>
            <button className={styles.btn} onClick={() => setView('avatar')} disabled={!canTryOn}>
              Try on my avatar
            </button>
            <button className={styles.btn} onClick={handleWardrobe}>Wardrobe</button>
          </div>
          {!canTryOn && (
            <p className={styles.hint}>
              No 3D model yet — you can check your size, but cannot try this item on.
            </p>
          )}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}

          {product.description && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Description</h2>
              <p className={styles.text}>{product.description}</p>
            </div>
          )}

          {(composition || product.care || product.countryOfOrigin) && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Composition & care</h2>
              <dl className={styles.facts}>
                {composition && (<><dt>Composition</dt><dd>{composition}</dd></>)}
                {product.care && (<><dt>Care</dt><dd>{product.care}</dd></>)}
                {product.countryOfOrigin && (<><dt>Made in</dt><dd>{product.countryOfOrigin}</dd></>)}
              </dl>
            </div>
          )}

          {chart.length > 0 && columns.length > 0 && (
            <div className={styles.chartBox}>
              <div className={styles.chartTitle}>Size chart · garment measurements, cm</div>
              <div className={styles.chartScroll}>
                <table className={styles.chart}>
                  <thead>
                    <tr>
                      <th>Size</th>
                      {columns.map(([key, label]) => <th key={key}>{label}</th>)}
                      <th>Cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.map((row) => (
                      <tr key={row.size}>
                        <td className={styles.sizeCell}>{row.size}</td>
                        {columns.map(([key]) => (
                          <td key={key}>{Number(row[key]) > 0 ? row[key] : '—'}</td>
                        ))}
                        <td>{FIT_LABELS[row.fit] || '—'}{row.stretch ? ` · ${row.stretch}% stretch` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <ProductReviews productId={sku} />
        </section>
      </div>
    </main>
  );
}
