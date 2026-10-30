// client/src/pages/FavoritesPage.jsx
//
// Избранное: вещи, отмеченные сердцем в каталоге (localStorage «favorites»), — теми же
// карточками, что в каталоге: свежие цена, размер, остаток берутся из каталога.
// Удалённые продавцом товары сюда не попадают.

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import ProductCardTall from '../components/ProductCardTall';
import styles from './HomePage.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

const favoriteIds = () => {
  try { return JSON.parse(localStorage.getItem('favorites') || '[]').map((x) => String(x.id || x._id)); }
  catch { return []; }
};

export default function FavoritesPage({ addToCart }) {
  const [catalog, setCatalog] = useState(null);
  const [ids, setIds] = useState(favoriteIds);

  useEffect(() => {
    let alive = true;
    axios.get(`${API_BASE}/api/products`)
      .then((r) => alive && setCatalog(Array.isArray(r.data) ? r.data : []))
      .catch(() => alive && setCatalog([]));
    // сердце сняли на карточке — список обновится при следующем фокусе страницы
    const sync = () => setIds(favoriteIds());
    window.addEventListener('focus', sync);
    return () => { alive = false; window.removeEventListener('focus', sync); };
  }, []);

  const items = useMemo(
    () => (catalog || []).filter((p) => ids.includes(String(p._id || p.id))),
    [catalog, ids],
  );

  return (
    <main className={`ui-container ${styles.catalogue} ${styles.listPage}`}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Wishlist</h1>
          {catalog && <span className={styles.count}>{items.length} {items.length === 1 ? 'item' : 'items'}</span>}
        </div>
      </div>

      {!catalog && <p className={styles.state}>Loading your wishlist…</p>}
      {catalog && items.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No saved items yet. Tap the heart on any item to keep it here.</p>
          <Link to="/" className="ui-btn">Browse the shop</Link>
        </div>
      )}
      {items.length > 0 && (
        <div className={styles.grid} style={{ marginTop: 'var(--sp-6)' }}>
          {items.map((p) => <ProductCardTall key={p._id || p.id} product={p} addToCart={addToCart} />)}
        </div>
      )}
    </main>
  );
}
