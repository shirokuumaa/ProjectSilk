// client/src/App.js
import React, { useState, useEffect, lazy } from 'react';
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
import ProductPage from './pages/ProductPage';
import SellerPanel from './pages/SellerPanel';
import Product3DViewer from './pages/Product3DViewer';
import AvatarCreate from './pages/AvatarCreate';
import OrderPage from "./pages/OrderPage"; 
import OrdersList from "./pages/OrdersList";
import DevOnly, { NotFound } from './components/DevOnly';



// ⬇️ единый слой ассистента (панель + шарик + голос)
import AssistantLayer from './components/AssistantLayer';
import SiteFooter from './components/SiteFooter';
import AccountSync from './components/AccountSync';
import { AUTH_EVENT, isLoggedIn } from './utils/auth';

// служебные страницы — только в режиме разработки (DevOnly), код грузится лениво
const Metrics = lazy(() => import('./pages/Metrics'));
const TripoSRDebug = lazy(() => import('./pages/TripoSRDebug'));
const AvatarCreateMode1Test = lazy(() => import('./pages/AvatarCreateMode1Test'));

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

  // вход, выход или смена аккаунта: корзину в localStorage могли стереть —
  // перечитываем, чтобы корзина прошлого пользователя не вернулась из памяти
  useEffect(() => {
    const reload = () => {
      try { setCartItems(JSON.parse(localStorage.getItem('cartItems') || '[]')); }
      catch { setCartItems([]); }
    };
    window.addEventListener(AUTH_EVENT, reload);
    return () => window.removeEventListener(AUTH_EVENT, reload);
  }, []);

  const handleAddToCart = (product) => {
    if (!isLoggedIn()) {
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
          path="/product/:id"
          element={<ProductPage addToCart={handleAddToCart} />}
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
        <Route path="/metrics" element={<DevOnly><Metrics /></DevOnly>} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/orders" element={<OrdersList sessionId={window.__SESSION_ID__} />} /> 
        <Route path="/triposr-debug" element={<DevOnly><TripoSRDebug /></DevOnly>} />
        <Route path="/avatar/mode1-test" element={<DevOnly><AvatarCreateMode1Test /></DevOnly>} />

        {/* любой несуществующий адрес — «Page not found» со ссылкой на главную */}
        <Route path="*" element={<NotFound />} />
        

        {/* Роут /assistant не нужен — ассистент как глобальный слой */}
      </Routes>

      <SiteFooter />

      {/* гардероб и обмеры вошедшего — с сервера; гостевые вещи — предложить перенести */}
      <AccountSync />

      {/* Глобальный слой ассистента поверх всех страниц */}
      <AssistantLayer />
    </Router>
  );
}

export default App;