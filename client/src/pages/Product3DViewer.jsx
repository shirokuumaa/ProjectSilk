// client/src/pages/Product3DViewer.jsx
import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import GlbViewer from '../components/GlbViewer';

export default function Product3DViewer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // Поддерживаем и новый формат (?src=...), и старый (?model=...)
  const rawSrc = params.get('src') || params.get('model');
  const src = rawSrc ? decodeURIComponent(rawSrc) : null;

  if (!src) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
          3D Viewer
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          GLB-ссылка не передана. Открой viewer из страницы аватара или
          гардероба.
        </p>
        <button
          onClick={() => navigate(-1)}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            borderRadius: 999,
            border: 'none',
            background: '#111827',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        3D Viewer
      </h1>

      <GlbViewer url={src} height={480} />

      <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
        GLB: {src}
      </p>

      <button
        onClick={() => navigate(-1)}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          borderRadius: 999,
          border: 'none',
          background: '#111827',
          color: 'white',
          cursor: 'pointer',
        }}
      >
        ← Back
      </button>
    </div>
  );
}