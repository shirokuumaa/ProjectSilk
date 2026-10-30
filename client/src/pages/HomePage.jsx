// client/src/pages/HomePage.jsx
//
// Витрина: слева — аватар покупателя (закреплён при прокрутке; у гостя — стандартная фигура),
// справа — каталог в 3 колонки: раздел (тип вещи, ?type=), поиск (?q=, из шапки), фильтры,
// сортировка (?sort=). «Try on» на карточке надевает вещь на этот аватар в рекомендованном размере.
// Шапка — общая для сайта (components/TopBar.jsx в App).

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

import ProductCardTall from '../components/ProductCardTall';
import CatalogFilters from '../components/CatalogFilters';
import HomeAvatar, { useHomeOutfit } from '../components/HomeAvatar';
import { SHOP_SECTIONS } from '../components/TopBar';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { activeFilterCount, filterCatalog, filtersFromParams, sizesOf } from '../utils/catalogFilter';
import styles from './HomePage.module.css';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

const SORTS = [
  ['new', 'Newest'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
];

export default function HomePage({ addToCart }) {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const { q, type, sort } = filters;

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

  const query = params.toString();
  const filtered = useMemo(
    () => filterCatalog(allProducts, filtersFromParams(new URLSearchParams(query)), profile),
    [allProducts, query, profile],
  );
  const sizes = useMemo(() => sizesOf(allProducts), [allProducts]);

  const setParams2 = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  const setParam = (key, value) => setParams2({ [key]: value });
  const clearFilters = () => setParams2({ min: '', max: '', size: '', fits: '', stock: '' });

  const outfit = useHomeOutfit(allProducts, profile === undefined ? null : profile);

  // карточку тащат — аватар подсвечен как место, куда бросить (всё время перетаскивания)
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (e) => {
      if (Array.from(e.dataTransfer?.types || []).includes('application/x-product-id')) setDragging(true);
    };
    const stop = () => setDragging(false);
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', stop);
      document.removeEventListener('drop', stop);
    };
  }, []);
  const dropProduct = (id) => {
    const product = allProducts.find((p) => String(p._id || p.id) === String(id));
    if (product) outfit.wear(product);
  };
  const sectionLabel = SHOP_SECTIONS.find(([t]) => t === type)?.[1];
  const heading = q ? `Results for “${q}”` : filters.fitsMe && !sectionLabel ? 'Fits me' : sectionLabel || 'New in';

  return (
    <main className={`ui-container ${styles.page} ${styles.shop}`}>
      <HomeAvatar
        profile={profile === undefined ? null : profile}
        outfit={outfit}
        dragging={dragging}
        onDropProduct={dropProduct}
      />

      <section id="catalogue" className={styles.catalogue}>
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

        <CatalogFilters
          filters={filters}
          sizes={sizes}
          hasBody={profile === undefined ? null : isProfileComplete(profile)}   // null — обмеры ещё грузятся
          onChange={setParams2}
          onClear={clearFilters}
        />

        {loading && <p className={styles.state}>Loading products…</p>}

        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              {q ? <>Nothing found for <strong>{q}</strong></>
                : activeFilterCount(filters) ? 'No items match these filters'
                  : 'Nothing in this section yet'}
            </p>
            {filters.fitsMe && <p className={styles.state}>“Fits me” shows items with a size that fits your figure and is in stock.</p>}
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
                onAvatar={outfit.wear}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
