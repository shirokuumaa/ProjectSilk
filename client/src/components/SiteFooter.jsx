// client/src/components/SiteFooter.jsx
//
// Подвал сайта: атрибуции, которых требуют лицензии используемых материалов.
// Шкала тонов кожи Monk Skin Tone — CC BY 4.0, автора нужно указать.

import React from 'react';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <span>Credits: </span>
      skin tone palette based on the{' '}
      <a href="https://skintone.google" target="_blank" rel="noreferrer">Monk Skin Tone Scale</a>
      {' '}by Dr. Ellis Monk, Google LLC, licensed under{' '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
    </footer>
  );
}
