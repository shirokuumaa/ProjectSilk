import React from 'react';
import styles from '../pages/HomePage.module.css';

export default function AvatarPanel() {
  return (
    <aside className={styles.avatarCol}>
      <div className={styles.avatarBox}>
        <div className={styles.avatarEmoji}>🧍</div>
        <div className={styles.avatarLabel}>3D Avatar placeholder</div>
      </div>
    </aside>
  );
}