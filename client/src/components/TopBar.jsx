import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './TopBar.module.css';
import MegaMenu from './MegaMenu';
import { askFizzy } from '../utils/fizzyAI'; // Подключаем ИИ
import { Link } from 'react-router-dom';

export default function TopBar({ search, setSearch, cartItems }) {
  const [showProfile, setShowProfile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const closeTimer = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const loggedInUser = localStorage.getItem('loggedInUser');

  // Категории — hover-меню
  const handleMouseEnter = () => {
    clearTimeout(closeTimer.current);
    setShowMenu(true);
  };

  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setShowMenu(false), 300);
  };

  // 🎤 Voice Search
  const handleVoiceSearch = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("❌ Voice search is not supported in your browser.");
      return;
    }

    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setSearch(transcript);
    };

    recognition.start();
  };

  // 📷 Image search
  const handleImageSearch = (e) => {
    const file = e.target.files[0];
    if (file) {
      const name = file.name.split('.')[0].replace(/[_\-]/g, ' ');
      setSearch(name);
    }
  };

  // 🧠 Fizzy AI Assistant
  const handleFizzyActivate = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Fizzy needs a browser that supports voice recognition.');
      return;
    }

    <span className={styles.icon} onClick={() => navigate('/all-products')}></span>

    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = 'en-US';

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log('🐼 Fizzy heard:', transcript);

      const reply = await askFizzy(transcript);
      speak(reply);
    };

    recognition.start();
  };

  const speak = (text) => {
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    synth.speak(utter);
  };

  // 👤 Логин / Логаут
  const handleLogout = () => {
    localStorage.removeItem('loggedInUser');
    alert('You have been logged out!');
    window.location.reload();
  };

  const handleFavoritesClick = () => {
    if (!loggedInUser) {
      alert('Please log in to access favorites.');
      return;
    }
    navigate('/favorites');
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.topBar}>
        {/* Left: Логотип и Категории */}
        <div className={styles.left}>
          <span className={styles.logo}>🩵 ProjectSilk</span>

          <div className={styles.menuWrapper} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <div className={styles.menuButton}>Categories ⏷</div>
            {showMenu && (
              <div className={styles.menuContainer}>
                <MegaMenu />
              </div>
            )}
          </div>
        </div>

        {/* 🔍 Поиск */}
        <div className={styles.searchBlock}>
          <input
            className={styles.searchInput}
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className={styles.icon} onClick={() => setSearch(search)}>🔍</button>
          <span className={styles.icon} onClick={handleVoiceSearch}>🎤</span>
          <span className={styles.icon} onClick={() => fileInputRef.current.click()}>📷</span>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleImageSearch}
          />
        </div>

        {/* Right: Личный кабинет, Избранное, Корзина, Гардероб, Fizzy */}
        <div className={styles.right}>
          <span className={styles.icon} onClick={() => setShowProfile(!showProfile)}>👤</span>
          <span className={styles.icon} onClick={handleFavoritesClick}>❤️</span>
          <span className={styles.icon} onClick={() => navigate('/cart')}>
            🛒 {totalItems > 0 && <span style={{ fontSize: '14px' }}>({totalItems})</span>}
          </span>
          <span className={styles.icon} onClick={() => navigate('/wardrobe')}>🧥</span>
          <button
            className={styles.fizzyButton}
            onClick={handleFizzyActivate}
            title="Hey Fizzy!"
          >
            🐼
          </button>
        </div>
      </div>

      <Link to="/seller">
  <button style={{ marginLeft: '10px' }}>👛 I'm a Seller</button>
</Link> 

      {/* 👤 Профиль (выпадающее меню) */}
      {showProfile && (
        <div className={styles.profileBox}>
          {loggedInUser ? (
            <>
              <p>Welcome back, <strong>{loggedInUser}</strong>! 👋</p>
              <button className={styles.loginBtn} onClick={handleLogout}>Logout</button>
            </>
          ) : (
            <>
              <p>Welcome, guest! 👤</p>
              <button className={styles.loginBtn} onClick={() => navigate('/login')}>Login</button>
              <button className={styles.registerBtn} onClick={() => navigate('/register')}>Register</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}