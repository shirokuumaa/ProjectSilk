// client/src/pages/HomePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

import TopBar from '../components/TopBar';
import CategoryMenu from '../components/CategoryMenu';
import AvatarPanel from '../components/AvatarPanel';
import RightDock from '../components/RightDock';
import ProductCardTall from '../components/ProductCardTall';
import styles from './HomePage.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

export default function HomePage({
  search, setSearch,
  category, setCategory,
  cartItems,
  addToCart,
}) {
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/products`);
        if (!canceled) setAllProducts(res.data || []);
      } catch {
        if (!canceled) setAllProducts([]);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return (allProducts || []).filter((p) => {
      const inCat = category === 'All' || p.category === category;
      if (!inCat) return false;
      if (!q) return true;
      const hay = `${p.title || ''} ${p.name || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allProducts, category, search]);

  return (
    <div className={styles.page}>
      <div className={styles.site}>
        <TopBar search={search} setSearch={setSearch} cartItems={cartItems} />
        <CategoryMenu selected={category} onSelect={setCategory} />

        <div className={styles.homebody}>
          <AvatarPanel />

          <section className={styles.grid}>
            {loading && <p className={styles.state}>Loading products…</p>}

            {!loading && filtered.length === 0 && (
              <p className={styles.state}>
                {search
                  ? <>Nothing found for <strong>{search}</strong></>
                  : 'Nothing in this category yet'}
              </p>
            )}

            {!loading && filtered.map((product) => (
              <ProductCardTall
                key={product._id || product.id}
                product={product}
                addToCart={addToCart}
              />
            ))}
          </section>

          <RightDock />
        </div>
      </div>
    </div>
  );
}
