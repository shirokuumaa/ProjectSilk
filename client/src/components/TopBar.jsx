import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styles from './TopBar.module.css';
import MegaMenu from './MegaMenu';
import { AUTH_EVENT, getUsername, logout } from '../utils/auth';
import { categoryMenuEnabled, imageSearchEnabled } from '../utils/features';

export default function TopBar({ search, setSearch, cartItems }) {
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const closeTimer = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const totalItems = (cartItems || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const [loggedInUser, setLoggedInUser] = useState(getUsername);

  // вход/выход в другом месте (в т.ч. автоматический выход при истёкшем токене)
  useEffect(() => {
    const sync = () => setLoggedInUser(getUsername());
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  const handleMouseEnter = () => { clearTimeout(closeTimer.current); setShowMenu(true); };
  const handleMouseLeave = () => { closeTimer.current = setTimeout(() => setShowMenu(false), 300); };

  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Voice search is not supported in this browser.');
      return;
    }
    const r = new window.webkitSpeechRecognition();
    r.lang = 'en-US';
    r.onresult = (e) => setSearch(e.results[0][0].transcript);
    r.start();
  };

  const handleImageSearch = (e) => {
    const f = e.target.files?.[0];
    if (f) setSearch(f.name.split('.')[0].replace(/[_-]/g, ' '));
  };

  const handleLogout = async () => {
    await logout(); // сначала сервер стирает cookie входа
    window.location.reload();
  };

  return (
    <header className={styles.wrapper}>
      <div className={styles.row}>
        {/* левая часть */}
        <div className={styles.left}>
          <span className={styles.logo}>
            <i className={styles.logoDot} />
            ProjectSilk
          </span>

          {/* меню-заглушка («Bath / Storage») пока спрятано (utils/features.js) */}
          {categoryMenuEnabled() && (
            <div
              className={styles.menuWrapper}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button className={styles.menuBtn}>Categories ▾</button>
              {showMenu && (
                <div className={styles.menuContainer}>
                  <MegaMenu />
                </div>
              )}
            </div>
          )}
        </div>

        {/* центр */}
        <div className={styles.center}>
          <div className={styles.search}>
            <input
              className={styles.searchInput}
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className={styles.iconBtn} onClick={() => setSearch(search)} aria-label="Search">⌕</button>
            <button className={styles.iconBtn} onClick={handleVoiceSearch} aria-label="Search by voice">◉</button>
            {/* «поиск по картинке» ищет по имени файла — спрятан до настоящего (utils/features.js) */}
            {imageSearchEnabled() && (
              <>
                <button
                  className={styles.iconBtn}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Search by image"
                >
                  ▣
                </button>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageSearch}
                  style={{ display: 'none' }}
                />
              </>
            )}
          </div>

          <Link to="/seller" className={styles.sellerBtn}>I'm a Seller</Link>
        </div>

        {/* правая часть */}
        <div className={styles.right}>
          <button className={styles.navPill} onClick={() => setShowProfile(!showProfile)}>
            {loggedInUser ? loggedInUser : 'Sign in'}
          </button>
          <button className={styles.navPill} onClick={() => navigate('/orders')}>Orders</button>
          <button className={styles.navPill} onClick={() => navigate('/favorites')}>Fav</button>
          <button className={styles.navPill} onClick={() => navigate('/cart')}>
            Cart
            {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
          </button>
        </div>
      </div>

      {showProfile && (
        <div className={styles.profileBox}>
          {loggedInUser ? (
            <>
              <p>Signed in as <strong>{loggedInUser}</strong></p>
              <button className={styles.primary} onClick={handleLogout}>Sign out</button>
            </>
          ) : (
            <>
              <p>You're not signed in</p>
              <button className={styles.primary} onClick={() => navigate('/login')}>Sign in</button>
              <button className={styles.ghost} onClick={() => navigate('/register')}>Create account</button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
