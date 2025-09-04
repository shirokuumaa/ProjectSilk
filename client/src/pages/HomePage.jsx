import React, { useEffect, useMemo, useState } from 'react';
import ProductCard from '../components/ProductCard';
import TopBar from '../components/TopBar';
import CategoryMenu from '../components/CategoryMenu';
import styles from './HomePage.module.css';
// Удаляем import defaultProducts
import Fuse from 'fuse.js';
import axios from 'axios';

export default function HomePage({
  search, setSearch,
  category, setCategory,
  cartItems, addToCart
}) {
  const [allProducts, setAllProducts] = useState([]);

  // Загружаем товары из сервера при загрузке страницы
  useEffect(() => {
    axios.get('http://localhost:5001/api/products')
      .then(res => setAllProducts(res.data))
      .catch(err => console.error('❌ Ошибка загрузки товаров:', err));
  }, []);

  const fuseOptions = {
    keys: ['name', 'category', 'description', 'title'],
    threshold: 0.4,
  };

  const filteredProducts = useMemo(() => {
    let items = category === 'All'
      ? allProducts
      : allProducts.filter(p => p.category === category);

    if (search.trim() === '') {
      return items;
    }

    const fuse = new Fuse(items, fuseOptions);
    const result = fuse.search(search);
    return result.map(r => r.item);
  }, [search, category, allProducts]);

  return (
    <div>
      <TopBar search={search} setSearch={setSearch} cartItems={cartItems} />
      <CategoryMenu selected={category} onSelect={setCategory} />

      <main className={styles.grid}>
        {filteredProducts.map((product, index) => (
          <ProductCard
            key={product._id || index}
            product={product}
            addToCart={addToCart}
          />
        ))}

        {filteredProducts.length === 0 && (
          <p>🧐 Nothing found for your request: <strong>{search}</strong></p>
        )}
      </main>
    </div>
  );
}