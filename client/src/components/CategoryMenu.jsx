import React from 'react';
import styles from './CategoryMenu.module.css';

const CATEGORIES = ['All', 'Clothes', 'Home', 'Electronics'];

export default function CategoryMenu({ selected, onSelect }) {
  return (
    <div className={styles.cats}>
      {CATEGORIES.map((key) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`${styles.cat} ${selected === key ? styles.on : ''}`}
          aria-pressed={selected === key}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
