import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styles from './TopBar.module.css';
import MegaMenu from './MegaMenu';

export default function TopBar({ search, setSearch, cartItems }) {
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const closeTimer = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const totalItems = (cartItems || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const loggedInUser = localStorage.getItem('loggedInUser');

  const handleMouseEnter = () => { clearTimeout(closeTimer.current); setShowMenu(true); };
  const handleMouseLeave = () => { closeTimer.current = setTimeout(() => setShowMenu(false), 300); };

  // 🔍 / 🎤 / 📷
  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("❌ Voice search is not supported in your browser."); return;
    }
    const r = new window.webkitSpeechRecognition();
    r.lang = 'en-US';
    r.onresult = (e) => setSearch(e.results[0][0].transcript);
    r.start();
  };
  const handleImageSearch = (e) => {
    const f = e.target.files?.[0];
    if (f) setSearch(f.name.split('.')[0].replace(/[_-]/g, ' ')); // ← убрали лишний escape
  };

  const handleLogout = () => { localStorage.removeItem('loggedInUser'); window.location.reload(); };

  return (
    <header className={styles.wrapper}>
      <div className={styles.row}>
        {/* left: logo + categories */}
        <div className={styles.left}>
          <span className={styles.logo}>💙 ProjectSilk</span>

          <div className={styles.menuWrapper} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <button className={styles.menuBtn}>Categories ▾</button>
            {showMenu && (
              <div className={styles.menuContainer}>
                <MegaMenu />
              </div>
            )}
          </div>
        </div>

        {/* center: search + icons + I'm a Seller */}
        <div className={styles.center}>
          <div className={styles.search}>
            <input
              className={styles.searchInput}
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className={styles.iconBtn} onClick={() => setSearch(search)} aria-label="Search">🔍</button>
            <button className={styles.iconBtn} onClick={handleVoiceSearch} aria-label="Voice">🎤</button>
            <button className={styles.iconBtn} onClick={() => fileInputRef.current?.click()} aria-label="Image">📷</button>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSearch} style={{ display: 'none' }} />
          </div>

          <Link to="/seller" className={styles.sellerBtn}>👛 I’m a Seller</Link>
        </div>

        {/* right: account / orders / fav / cart */}
        <div className={styles.right}>
          <button className={styles.navPill} onClick={() => setShowProfile(!showProfile)}>👤 <span>Sign in</span></button>
          <button className={styles.navPill} onClick={() => navigate('/orders')}>📦 <span>Orders</span></button>
          <button className={styles.navPill} onClick={() => navigate('/favorites')}>❤️ <span>Fav</span></button>

          <button className={styles.navPill} onClick={() => navigate('/cart')}>
            🛒 <span>Cart</span>
            {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
          </button>
        </div>
      </div>

      {/* profile popover */}
      {showProfile && (
        <div className={styles.profileBox}>
          {loggedInUser ? (
            <>
              <p>Welcome back, <strong>{loggedInUser}</strong>! 👋</p>
              <button className={styles.primary} onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <p>Welcome, guest! 👤</p>
              <button className={styles.primary} onClick={() => navigate('/login')}>Login</button>
              <button className={styles.ghost} onClick={() => navigate('/register')}>Register</button>
            </>
          )}
        </div>
      )}
    </header>
  );
}