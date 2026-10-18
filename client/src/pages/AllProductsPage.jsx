// client/src/pages/AllProductsPage.jsx
//
// Все товары продавцов — та же карточка, что в каталоге на главной
// (клик ведёт на страницу товара). Адрес API — из REACT_APP_API, как везде.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ProductCardTall from '../components/ProductCardTall';

const API = process.env.REACT_APP_API || 'http://localhost:5050';

export default function AllProductsPage({ addToCart }) {
  const [products, setProducts] = useState(null); // null — ещё грузим
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API}/api/products`)
      .then((res) => setProducts(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error('Could not load products:', err);
        setProducts([]);
        setError('Could not load products. Please try again later.');
      });
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>🛍️ All Products from Sellers</h2>
      {products === null && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error && <p role="alert" style={{ color: 'var(--fit-bad)' }}>{error}</p>}
      {products?.length === 0 && !error && (
        <p style={{ color: 'var(--muted)' }}>No products yet.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
        {(products || []).map((product) => (
          <ProductCardTall key={product._id || product.id} product={product} addToCart={addToCart} />
        ))}
      </div>
    </div>
  );
}
