import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ProductCard from '../components/ProductCard';

const API = 'http://localhost:5000';

const fixImage = (p) => {
  const raw = p.image || p.imageUrl || '';
  if (!raw) return '';
  if (/^(https?:|blob:)/.test(raw)) return raw;
  return `${API}${raw.startsWith('/') ? '' : '/'}${raw}⁠`;
};

export default function AllProductsPage({ addToCart }) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    axios.get(`${API}/api/products`)
      .then((res) => {
        const normalized = (res.data || []).map((p) => ({ ...p, image: fixImage(p) }));
        setProducts(normalized);
      })
      .catch((err) => console.error('❌ Ошибка при загрузке товаров:', err));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>🛍️ All Products from Sellers</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {products.map((product) => (
          <ProductCard key={product._id || product.id} product={product} addToCart={addToCart} />
        ))}
      </div>
    </div>
  );
}