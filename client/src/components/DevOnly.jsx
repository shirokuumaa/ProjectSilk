// client/src/components/DevOnly.jsx
//
// Служебные страницы (метрики, отладка TripoSR, тест аватара Mode1) — только в режиме
// разработки (npm start). В сборке для покупателей вместо них «Page not found»,
// а сам код страниц грузится лениво и в продакшне не скачивается.
import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';

export const devToolsEnabled = () => process.env.NODE_ENV === 'development';

export function NotFound() {
  return (
    <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: '48px 16px', color: 'var(--ink)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 8px' }}>Page not found</h2>
      <p style={{ color: 'var(--muted)', margin: '0 0 16px' }}>This page does not exist or is not available.</p>
      <Link to="/" style={{ color: 'var(--ink)' }}>← Back to the shop</Link>
    </div>
  );
}

export default function DevOnly({ children }) {
  if (!devToolsEnabled()) return <NotFound />;
  return <Suspense fallback={<p style={{ padding: 24, color: 'var(--muted)' }}>Loading…</p>}>{children}</Suspense>;
}
