// client/src/components/TopBar.jsx
//
// Шапка сайта покупателя — одна на всех страницах (App, кроме кабинета продавца и AR).
// Строка сверху — обещание магазина и вход для продавцов; ниже — логотип, разделы
// одежды (тип вещи → /?type=…), поиск (→ /?q=…), примерочная, избранное, аккаунт, корзина.
// Имя магазина — из brand.js. Поиск по картинке и меню категорий спрятаны (utils/features.js).

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, Link, NavLink } from 'react-router-dom';
import styles from './TopBar.module.css';
import MegaMenu from './MegaMenu';
import { BRAND } from '../brand';
import { BagIcon, HangerIcon, HeartIcon, MicIcon, SearchIcon, UserIcon } from './Icons';
import { AUTH_EVENT, getUsername, logout } from '../utils/auth';
import { categoryMenuEnabled, imageSearchEnabled } from '../utils/features';

/** Разделы витрины: тип вещи товара (Product.garmentType). */
export const SHOP_SECTIONS = [
  ['dress', 'Dresses'],
  ['top', 'Tops'],
  ['bottom', 'Bottoms'],
  ['outerwear', 'Outerwear'],
  ['shoes', 'Shoes'],
  ['accessory', 'Accessories'],
];

export default function TopBar({ search, setSearch, cartItems }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [query, setQuery] = useState(search ?? params.get('q') ?? '');
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const closeTimer = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const totalItems = (cartItems || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const [loggedInUser, setLoggedInUser] = useState(getUsername);

  useEffect(() => {
    const sync = () => setLoggedInUser(getUsername());
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  // адрес сменился (раздел, назад в браузере) — строка поиска показывает текущий запрос
  const urlQuery = params.get('q') ?? '';
  useEffect(() => { if (search === undefined) setQuery(urlQuery); }, [urlQuery, search]);
  useEffect(() => setShowProfile(false), [location.pathname]);

  const runSearch = (text) => {
    const q = String(text ?? query).trim();
    if (typeof setSearch === 'function') setSearch(q);
    const next = new URLSearchParams(location.pathname === '/' ? location.search : '');
    if (q) next.set('q', q); else next.delete('q');
    const qs = next.toString();
    navigate(qs ? `/?${qs}` : '/');
  };

  const handleMouseEnter = () => { clearTimeout(closeTimer.current); setShowMenu(true); };
  const handleMouseLeave = () => { closeTimer.current = setTimeout(() => setShowMenu(false), 300); };

  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Voice search is not supported in this browser.');
      return;
    }
    const r = new window.webkitSpeechRecognition();
    r.lang = 'en-US';
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setQuery(text);
      runSearch(text);
    };
    r.start();
  };

  const handleImageSearch = (e) => {
    const f = e.target.files?.[0];
    if (f) runSearch(f.name.split('.')[0].replace(/[_-]/g, ' '));
  };

  const handleLogout = async () => {
    await logout(); // сначала сервер стирает cookie входа
    window.location.reload();
  };

  const activeType = location.pathname === '/' ? params.get('type') : null;

  return (
    <header className={styles.wrapper}>
      <div className={styles.utility}>
        <div className={`ui-container ${styles.utilityRow}`}>
          <span>{BRAND.tagline} — free try-on on your own avatar</span>
          <Link to="/seller" className={styles.utilityLink}>Sell on {BRAND.name}</Link>
        </div>
      </div>

      <div className={`ui-container ${styles.row}`}>
        <Link to="/" className={styles.logo} aria-label={`${BRAND.name} — home`}>{BRAND.name}</Link>

        <nav className={styles.sections} aria-label="Shop sections">
          <Link to="/" className={`${styles.section} ${location.pathname === '/' && !activeType ? styles.sectionOn : ''}`}>
            New in
          </Link>
          {SHOP_SECTIONS.slice(0, 4).map(([type, label]) => (
            <Link
              key={type}
              to={`/?type=${type}`}
              className={`${styles.section} ${activeType === type ? styles.sectionOn : ''}`}
            >
              {label}
            </Link>
          ))}
          {/* меню-заглушка («Bath / Storage») пока спрятано (utils/features.js) */}
          {categoryMenuEnabled() && (
            <div className={styles.menuWrapper} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
              <button className={styles.section}>Categories ▾</button>
              {showMenu && (
                <div className={styles.menuContainer}>
                  <MegaMenu />
                </div>
              )}
            </div>
          )}
        </nav>

        <form className={styles.search} role="search" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search dresses, trousers, coats…"
            aria-label="Search the shop"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className={styles.searchGo} aria-label="Search">Search</button>
          <button type="button" className={styles.iconBtn} onClick={handleVoiceSearch} aria-label="Search by voice">
            <MicIcon size={18} />
          </button>
          {/* «поиск по картинке» ищет по имени файла — спрятан до настоящего (utils/features.js) */}
          {imageSearchEnabled() && (
            <>
              <button type="button" className={styles.iconBtn} onClick={() => fileInputRef.current?.click()} aria-label="Search by image">
                ▣
              </button>
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSearch} style={{ display: 'none' }} />
            </>
          )}
        </form>

        <div className={styles.actions}>
          <NavLink to="/wardrobe" className={styles.action} title="Fitting room">
            <HangerIcon /><span className={styles.actionLabel}>Fitting room</span>
          </NavLink>
          <NavLink to="/favorites" className={styles.action} title="Wishlist">
            <HeartIcon /><span className={styles.actionLabel}>Wishlist</span>
          </NavLink>

          <div className={styles.profileWrap}>
            <button
              className={styles.action}
              onClick={() => (loggedInUser ? setShowProfile((v) => !v) : navigate('/login'))}
              aria-haspopup={loggedInUser ? 'menu' : undefined}
              aria-expanded={loggedInUser ? showProfile : undefined}
            >
              <UserIcon /><span className={styles.actionLabel}>{loggedInUser || 'Sign in'}</span>
            </button>
            {loggedInUser && showProfile && (
              <div className={styles.profileMenu} role="menu">
                <div className={styles.profileName}>Signed in as <b>{loggedInUser}</b></div>
                <Link role="menuitem" to="/orders" className={styles.menuItem}>My orders</Link>
                <Link role="menuitem" to="/avatar/create" className={styles.menuItem}>My measurements</Link>
                <Link role="menuitem" to="/wardrobe" className={styles.menuItem}>Fitting room</Link>
                <button role="menuitem" className={styles.menuItem} onClick={handleLogout}>Sign out</button>
              </div>
            )}
          </div>

          <NavLink to="/cart" className={styles.action} title="Cart" aria-label={`Cart, ${totalItems} item${totalItems === 1 ? '' : 's'}`}>
            <BagIcon />
            {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
            <span className={styles.actionLabel}>Cart</span>
          </NavLink>
        </div>
      </div>
    </header>
  );
}
