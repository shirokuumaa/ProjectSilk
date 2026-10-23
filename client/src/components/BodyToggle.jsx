// client/src/components/BodyToggle.jsx
//
// «Hide body» / «Show body» — общая кнопка примерки и гардероба. Заметная: значок,
// подпись и акцентная рамка. Кому неприятно смотреть на свою фигуру — убирает тело
// одним нажатием, одежда остаётся на месте.
import React from 'react';
import styles from './BodyToggle.module.css';

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      {off && <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M3 3l18 18" />}
    </svg>
  );
}

export default function BodyToggle({ shown, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${shown ? '' : styles.hidden} ${className}`}
      onClick={onToggle}
      aria-pressed={!shown}
      title={shown ? 'Hide the body and see only the clothes' : 'Show the body again'}
    >
      <EyeIcon off={shown} />
      {shown ? 'Hide body' : 'Show body'}
    </button>
  );
}
