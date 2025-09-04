import React from 'react';
import styles from './FizzyButton.module.css';

export default function FizzyButton({ onClick }) {
  return (
    <button className={styles.fizzyBtn} onClick={onClick} title="Hey Fizzy!">
      🐼
    </button>
  );
}