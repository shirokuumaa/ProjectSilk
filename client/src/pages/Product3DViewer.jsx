// client/src/pages/Product3DViewer.jsx
import React, { useEffect } from 'react';

export default function Product3DViewer() {
  const params = new URLSearchParams(window.location.search);
  const modelUrl = params.get('model');

  useEffect(() => {
    // динамически подключим модель-вьювер
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, []);

  if (!modelUrl) return <p style={{ padding: 16 }}>Нет model URL</p>;

  return (
    <div style={{ padding: 16 }}>
      <h3>3D Preview</h3>
      <model-viewer
        src={modelUrl}
        alt="3D garment"
        camera-controls
        auto-rotate
        style={{ width: '100%', height: '70vh', background:'#f8f8f8', borderRadius: 8 }}
      ></model-viewer>
    </div>
  );
}