// client/src/components/SiteFooter.jsx
//
// Подвал сайта: разделы магазина, примерка, продавцам — и атрибуции, которых требуют
// лицензии используемых материалов. Шкала тонов кожи Monk Skin Tone — CC BY 4.0, автора нужно указать.

import React from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../brand';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`ui-container ${styles.cols}`}>
        <div className={styles.brand}>
          <div className={styles.logo}>{BRAND.name}</div>
          <p>{BRAND.tagline}. Every item is tried on your own avatar, in the seller’s real sizes.</p>
        </div>
        <nav className={styles.col} aria-label="Shop">
          <b>Shop</b>
          <Link to="/?type=dress">Dresses</Link>
          <Link to="/?type=top">Tops</Link>
          <Link to="/?type=bottom">Bottoms</Link>
          <Link to="/?type=outerwear">Outerwear</Link>
        </nav>
        <nav className={styles.col} aria-label="Your fit">
          <b>Your fit</b>
          <Link to="/avatar/create">Create my avatar</Link>
          <Link to="/wardrobe">Fitting room</Link>
          <Link to="/orders">My orders</Link>
        </nav>
        <nav className={styles.col} aria-label="Sellers">
          <b>Sellers</b>
          <Link to="/seller">Sell on {BRAND.name}</Link>
        </nav>
      </div>
      <div className={`ui-container ${styles.credits}`}>
        <span>© {new Date().getFullYear()} {BRAND.name}</span>
        <span>
          Credits: skin tone palette based on the{' '}
          <a href="https://skintone.google" target="_blank" rel="noreferrer">Monk Skin Tone Scale</a>
          {' '}by Dr. Ellis Monk, Google LLC, licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
        </span>
      </div>
    </footer>
  );
}
