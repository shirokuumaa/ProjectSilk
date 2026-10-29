// client/src/components/SellerHeader.jsx
//
// Шапка кабинета продавца: под каким магазином вошёл, ссылка обратно в магазин,
// выход. В кабинете нет поиска и корзины, поэтому общая TopBar сюда не подходит.
import React from 'react';
import { Link } from 'react-router-dom';
import { logout } from '../utils/auth';
import { BRAND } from '../brand';
import styles from './SellerHeader.module.css';

export default function SellerHeader({ username = null, storeName = null }) {
  const signOut = async () => {
    await logout(); // сначала сервер стирает cookie входа
    window.location.assign('/');
  };

  return (
    <header className={styles.wrapper}>
      <div className={styles.row}>
        <Link to="/" className={styles.logo}>
          <i className={styles.logoDot} />
          {BRAND.name}
          <span className={styles.section}>Seller</span>
        </Link>

        {username && (
          <span className={styles.who}>
            Signed in as <b>{username}</b>
            {storeName && <> · Store: <b>{storeName}</b></>}
          </span>
        )}

        <nav className={styles.right}>
          <Link to="/" className={styles.pill}>View shop</Link>
          {username && (
            <button type="button" className={styles.pill} onClick={signOut}>Sign out</button>
          )}
        </nav>
      </div>
    </header>
  );
}
