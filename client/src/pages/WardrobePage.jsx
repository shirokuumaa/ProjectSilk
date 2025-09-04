import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function WardrobePage() {
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const [photo, setPhoto] = useState(null);
  const [items, setItems] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Загружаем гардероб из localStorage
  useEffect(() => {
    const wardrobe = JSON.parse(localStorage.getItem('wardrobeItems')) || [];
    const enhanced = wardrobe.map((item, index) => ({
      ...item,
      x: 50 + index * 60,
      y: 100,
      scale: 1,
    }));
    setItems(enhanced);
  }, []);

  // Загружаем фото
  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Отрисовка
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !photo) return;

    const bg = new Image();
    bg.src = photo;
    bg.onload = () => {
      canvas.width = bg.width;
      canvas.height = bg.height;
      ctx.drawImage(bg, 0, 0);

      items.forEach((item) => {
        const img = new Image();
        img.src = item.image;
        img.onload = () => {
          ctx.drawImage(
            img,
            item.x,
            item.y,
            img.width * item.scale,
            img.height * item.scale
          );
        };
      });
    };
  }, [photo, items]);

  // Масштабирование колесиком
  const handleWheel = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newItems = items.map((item, index) => {
      const img = new Image();
      img.src = item.image;
      const w = img.width * item.scale;
      const h = img.height * item.scale;

      if (
        mouseX >= item.x &&
        mouseX <= item.x + w &&
        mouseY >= item.y &&
        mouseY <= item.y + h
      ) {
        const newScale = Math.max(0.2, item.scale + (e.deltaY > 0 ? -0.05 : 0.05));
        return { ...item, scale: newScale };
      }
      return item;
    });

    setItems(newItems);
  };

  // Перетаскивание
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const index = items.findIndex((item) => {
      const img = new Image();
      img.src = item.image;
      const w = img.width * item.scale;
      const h = img.height * item.scale;
      return x >= item.x && x <= item.x + w && y >= item.y && y <= item.y + h;
    });

    if (index !== -1) {
      setDraggedIndex(index);
    }
  };

  const handleMouseMove = (e) => {
    if (draggedIndex === null) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const updated = [...items];
    updated[draggedIndex] = {
      ...updated[draggedIndex],
      x: x - 50,
      y: y - 50,
    };
    setItems(updated);
  };

  const handleMouseUp = () => {
    setDraggedIndex(null);
  };

  // Очистка гардероба
  const handleClear = () => {
    setPhoto(null);
    setItems([]);
    localStorage.removeItem('wardrobeItems');
  };

  return (
    <div>
      <h2>👗 Try-On Wardrobe</h2>

      {/* КНОПКИ НАВИГАЦИИ НА РАЗНЫЕ ВИДЫ ПРИМЕРКИ */}
      <div style={{ marginTop: "20px", marginBottom: "20px" }}>
        <h3>✨ Choose Try-On Type:</h3>
        <button onClick={() => navigate('/tryon/photo')}>📷 Try-On by Photo</button>{' '}
        <button onClick={() => navigate('/tryon/ar')}>📸 AR Try-On</button>{' '}
        <button onClick={() => navigate('/tryon/avatar')}>🧍 Try-On on Avatar</button>
      </div>

      {/* Загрузка фото и кнопка очистки */}
      <input type="file" accept="image/*" onChange={handlePhotoUpload} />
      <button onClick={handleClear}>❌ Clear All</button>

      {/* Canvas с примеркой */}
      {photo && (
        <canvas
          ref={canvasRef}
          style={{ border: '1px solid #ccc', marginTop: '10px', cursor: 'move' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        />
      )}

      {/* Сообщения, если фото нет */}
      {!photo && items.length > 0 && (
        <p>🖼 Upload a photo to try on your clothes.</p>
      )}

      {items.length === 0 && !photo && (
        <p>🧸 Your wardrobe is empty.</p>
      )}
    </div>
  );
}