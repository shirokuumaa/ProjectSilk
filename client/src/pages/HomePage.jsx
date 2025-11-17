// client/src/pages/HomePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import TopBar from '../components/TopBar';
import CategoryMenu from '../components/CategoryMenu';
import AvatarPanel from '../components/AvatarPanel';
import RightDock from '../components/RightDock';
import ProductCardTall from '../components/ProductCardTall';
import styles from './HomePage.module.css';
import axios from 'axios';

export default function HomePage({
  search, setSearch,
  category, setCategory,
  cartItems,
  addToCart
}) {
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Загружаем товары
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await axios.get('http://localhost:5050/api/products');
        if (!canceled) setAllProducts(res.data || []);
      } catch {
        if (!canceled) setAllProducts([]);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  // Фильтрация по категории и поиску (без Fuse для простоты)
  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return (allProducts || []).filter(p => {
      const inCat = category === 'All' || p.category === category;
      if (!inCat) return false;
      if (!q) return true;
      const hay = `${p.title || ''} ${p.name || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allProducts, category, search]);

  return (
    <div>
      <TopBar search={search} setSearch={setSearch} cartItems={cartItems} />
      <CategoryMenu selected={category} onSelect={setCategory} />

      <div className={styles.layout}>
        {/* левая колонка под 3D-аватар */}
        <AvatarPanel />

        {/* центральная область с карточками */}
        <section className={styles.mainArea}>
          {loading && <p style={{ padding: 12 }}>Загружаем товары…</p>}

          {!loading && filtered.length === 0 && (
            <p style={{ padding: 12 }}>
              Ничего не найдено по запросу: <strong>{search}</strong>
            </p>
          )}

          {!loading && filtered.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16
              }}
            >
              {filtered.map((product) => (
                <ProductCardTall
                  key={product._id || product.id}
                  product={product}
                  addToCart={addToCart}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* правая вертикальная панель (AI / Wardrobe / Support) */}
      <RightDock />
    </div>
  );
}