// client/src/pages/ProductPage.jsx
//
// Страница товара /product/:id: фото, название, цена, размерная сетка продавца
// и полный разбор размера (SizeAdvisor, mode="full"). Без обмеров покупателя
// SizeAdvisor сам показывает кнопку «Add your measurements» вместо разбора.
// Весь текст интерфейса — на английском, цвета — из styles/tokens.css.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SizeAdvisor from '../components/SizeAdvisor';
import { addToWardrobe } from '../utils/wardrobeStorage';
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
];
const FIT_LABELS = { tight: 'Fitted', regular: 'Regular', loose: 'Loose / oversized' };

export default function ProductPage({ addToCart }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [product, setProduct] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | error
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    setState('loading');
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

  const chart = useMemo(() => product?.sizeChart || [], [product]);
  const columns = useMemo(
    () => CHART_FIELDS.filter(([key]) => chart.some((row) => Number(row[key]) > 0)),
    [chart],
  );

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
  const image = toPublicUrl(product.image);
  const has3d = Boolean(product.model3d);

  const flash = (text) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 2500);
  };

  const handleWardrobe = () => {
    addToWardrobe({ ...product, id: sku, image });
    flash('Saved to your wardrobe');
  };

  const handleCart = () => {
    if (typeof addToCart !== 'function') return nav('/cart');
    addToCart({
      id: sku, _id: sku, name: displayName, price: product.price || 0,
      image, category: product.category, quantity: 1,
    });
    flash('Added to cart');
  };

  return (
    <main className={styles.page}>
      <Link className={styles.back} to="/">← Back to the shop</Link>

      <div className={styles.layout}>
        <div className={styles.media}>
          <img className={styles.image} src={image} alt={displayName} />
        </div>

        <section className={styles.info}>
          <h1 className={styles.title}>{displayName}</h1>
          <div className={styles.price}>
            {Number(product.price || 0).toLocaleString('en-US')} <span className={styles.priceUnit}>₸</span>
          </div>

          <SizeAdvisor product={product} mode="full" />

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

          <div className={styles.actions}>
            <button
              className={styles.btnDark}
              onClick={() => nav(`/tryon/avatar?sku=${encodeURIComponent(sku)}`)}
              disabled={!has3d}
            >
              Try on
            </button>
            <button className={styles.btn} onClick={handleWardrobe}>Wardrobe</button>
            <button className={styles.btn} onClick={handleCart}>Add to cart</button>
          </div>
          {!has3d && (
            <p className={styles.hint}>
              No 3D model yet — you can check your size, but cannot try this item on.
            </p>
          )}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
        </section>
      </div>
    </main>
  );
}
