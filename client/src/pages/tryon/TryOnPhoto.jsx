import React, { useEffect, useRef, useState } from "react";

function TryOnPhoto() {
  const canvasRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [items, setItems] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Загружаем гардероб из localStorage
  useEffect(() => {
    const wardrobe = JSON.parse(localStorage.getItem("wardrobeItems")) || [];
    const positioned = wardrobe.map((item, index) => ({
      ...item,
      x: 50 + index * 60,
      y: 100,
      scale: 1,
    }));
    setItems(positioned);
  }, []);

  // Обработка загрузки фото
  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Отрисовка одежды на фото
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
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

  // Масштабирование
  const handleWheel = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const updated = items.map((item) => {
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

    setItems(updated);
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

  const handleMouseUp = () => setDraggedIndex(null);

  const handleClear = () => {
    setPhoto(null);
    setItems([]);
  };

  return (
    <div>
      <h2>📸 Try-On by Photo</h2>
      <input type="file" accept="image/*" onChange={handlePhotoUpload} />
      <button onClick={handleClear}>❌ Clear</button>

      {photo && (
        <canvas
          ref={canvasRef}
          style={{ border: "1px solid #ccc", marginTop: "10px", cursor: "move" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        />
      )}

      {!photo && items.length > 0 && <p>🖼 Upload your photo to try on items!</p>}
      {!photo && items.length === 0 && <p>🧸 Your wardrobe is empty!</p>}
    </div>
  );
}

export default TryOnPhoto;