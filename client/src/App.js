// client/src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import HomePage from './pages/HomePage';
import CartPage from './pages/CartPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import FavoritesPage from './pages/FavoritesPage';
import WardrobePage from './pages/WardrobePage';
import TryOnPhoto from './pages/tryon/TryOnPhoto';
import TryOnAR from './pages/tryon/TryOnAR';
import TryOnAvatar from './pages/tryon/TryOnAvatar';
import AllProductsPage from './pages/AllProductsPage';
import SellerPanel from './pages/SellerPanel';
import Product3DViewer from './pages/Product3DViewer';
import AvatarCreate from './pages/AvatarCreate';
import Metrics from "./pages/Metrics";
import OrderPage from "./pages/OrderPage"; 
import OrdersList from "./pages/OrdersList";


// ⬇️ единый слой ассистента (панель + шарик + голос)
import AssistantLayer from './components/AssistantLayer';

function App() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  const [cartItems, setCartItems] = useState(() => {
    const saved = localStorage.getItem('cartItems');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('cartItems', JSON.stringify(cartItems));
  }, [cartItems]);

  const handleAddToCart = (product) => {
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
      alert('Please log in to add items to the cart.');
      return;
    }

    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        return [...prev, { ...product, quantity: 1 }];
      }
    });
  };

  const handleRemoveFromCart = (id) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.id === id
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  return (
    <Router>
      {/* Основной роутинг приложения */}
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              search={search}
              setSearch={setSearch}
              category={category}
              setCategory={setCategory}
              cartItems={cartItems}
              addToCart={handleAddToCart}
            />
          }
        />

        <Route
          path="/all-products"
          element={<AllProductsPage addToCart={handleAddToCart} />}
        />
        <Route
          path="/cart"
          element={
            <CartPage cartItems={cartItems} onRemove={handleRemoveFromCart} />
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/wardrobe" element={<WardrobePage />} />
        <Route path="/tryon/photo" element={<TryOnPhoto />} />
        <Route path="/tryon/ar" element={<TryOnAR />} />
        <Route path="/tryon/avatar" element={<TryOnAvatar />} />
        <Route path="/seller" element={<SellerPanel />} />
        <Route path="/viewer" element={<Product3DViewer />} />
        <Route path="/avatar/create" element={<AvatarCreate />} />
        <Route path="/metrics" element={<Metrics/>} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/orders" element={<OrdersList sessionId={window.__SESSION_ID__} />} />    

        {/* Роут /assistant не нужен — ассистент как глобальный слой */}
      </Routes>

      {/* Глобальный слой ассистента поверх всех страниц */}
      <AssistantLayer />
    </Router>
  );
}

export default App;