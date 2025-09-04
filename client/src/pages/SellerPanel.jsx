import React, { useState } from 'react';
const API = 'http://localhost:5000'; // единый API

export default function SellerPanel() {
  const [processedImage, setProcessedImage] = useState(null);
  const [processedImageBlob, setProcessedImageBlob] = useState(null);
  const [model3dFile, setModel3dFile] = useState(null);     // ← 3D модель (опционально)

  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // 1) Удаление фона у картинки
  const handleImageUpload = async (file) => {
    setProcessedImage(null);
    setProcessedImageBlob(null);
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const resp = await fetch('http://localhost:5000/ai/remove-background', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error('Server error');

      const blob = await resp.blob();
      setProcessedImage(URL.createObjectURL(blob));
      setProcessedImageBlob(blob);
    } catch (e) {
      console.error(e);
      setError('Не удалось обработать изображение. Попробуй ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  // 2) Сохранение товара (картинка + опционально файл 3D)
  const handleSave = async () => {
    try {
      const title = document.getElementById('title').value.trim();
      const price = Number(document.getElementById('price').value);
      if (!title || !price || !processedImageBlob) {
        alert('Заполни название, цену и картинку');
        return;
      }
      setSaving(true);

      const fd = new FormData();
      fd.append('title', title);
      fd.append('price', String(price));
      fd.append('image', processedImageBlob, 'product.png');   // картинка
      if (model3dFile) {
        fd.append('model3d', model3dFile, model3dFile.name);   // ← ВОТ ТУТ ДОБАВЛЯЕМ 3D-ФАЙЛ
      }

      const resp = await fetch(`${API}/api/products`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('API error');
      await resp.json();
      alert('✅ Товар сохранён! Открой вкладку All Products');

      // очистка формы
      document.getElementById('title').value = '';
      document.getElementById('price').value = '';
      setProcessedImage(null);
      setProcessedImageBlob(null);
      setModel3dFile(null);
    } catch (e) {
      console.error(e);
      alert('Ошибка сохранения товара');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h2>👕 Загрузка товара продавцом</h2>

      {/* Картинка для удаления фона */}
      <label style={{ display: 'block', marginBottom: 8 }}>Изображение товара</label>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
      />

      {/* Опциональная 3D-модель */}
      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          3D-модель (опционально) — лучше .glb/.gltf
        </label>
        <input
          type="file"
          accept=".glb,.gltf,.obj,.fbx,.usdz"
          onChange={(e) => setModel3dFile(e.target.files?.[0] || null)}
        />
        {model3dFile && (
          <small style={{ display: 'block', marginTop: 6 }}>
            Файл: {model3dFile.name} ({(model3dFile.size / 1024 / 1024).toFixed(2)} MB)
          </small>
        )}
      </div>

      {loading && <p style={{ marginTop: 16 }}>⏳ Обрабатываем…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {processedImage && (
        <div style={{ marginTop: 20, maxWidth: 420 }}>
          <img src={processedImage} alt="png без фона" style={{ width: '100%', borderRadius: 8 }} />
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <input id="title" placeholder="Название товара" />
            <input id="price" placeholder="Цена" type="number" min="0" />
            <button onClick={handleSave} disabled={saving}>
              {saving ? 'Сохраняю…' : '💾 Сохранить в БД'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}