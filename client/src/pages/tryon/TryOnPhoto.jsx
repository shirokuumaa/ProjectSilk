import React, { useState } from "react";
import axios from "axios";
import { getBaseURL } from "../../assistant/api"; // Берем адрес из нашего api.js

function TryOnPhoto() {
  const [humanImg, setHumanImg] = useState(null); // Фото человека
  const [garmentImg, setGarmentImg] = useState(null); // Фото одежды
  const [resultImg, setResultImg] = useState(null); // Результат от ИИ
  const [loading, setLoading] = useState(false); // Статус загрузки

  // Обработчик выбора файла
  const handleFileChange = (e, setFile) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Кнопка "Примерить"
  const handleGenerate = async () => {
    if (!humanImg || !garmentImg) {
      alert("Please add both photos: one of you and one of the garment.");
      return;
    }

    setLoading(true);
    setResultImg(null); // Сбрасываем старый результат

    try {
      // 1. Готовим данные
      const formData = new FormData();
      formData.append("human", humanImg);
      formData.append("garment", garmentImg);

      // 2. Отправляем на Lightning AI
      // Используем getBaseURL(), куда мы вставили ссылку на туннель
      const response = await axios.post(`${getBaseURL()}/tryon`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob", // Ожидаем картинку в ответе
      });

      // 3. Показываем результат
      const imageUrl = URL.createObjectURL(response.data);
      setResultImg(imageUrl);
      
    } catch (error) {
      console.error("Photo try-on failed:", error);
      alert("The AI try-on is not available right now. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "40px", textAlign: "center", maxWidth: "800px", margin: "0 auto" }}>
      <h1 className="text-3xl font-bold mb-8">Try on with a photo</h1>
      
      <div style={{ display: "flex", justifyContent: "center", gap: "20px", marginBottom: "30px", flexWrap: "wrap" }}>
        {/* Карточка: Человек */}
        <div style={{ border: "2px dashed var(--line-dashed)", padding: "20px", borderRadius: "12px", width: "300px" }}>
          <h3 className="text-xl mb-4">1. Your photo</h3>
          <input type="file" onChange={(e) => handleFileChange(e, setHumanImg)} accept="image/*" />
          {humanImg && (
            <img 
              src={URL.createObjectURL(humanImg)} 
              alt="Human" 
              style={{marginTop: 15, width: "100%", borderRadius: 8, maxHeight: "300px", objectFit: "contain"}}
            />
          )}
        </div>

        {/* Карточка: Одежда */}
        <div style={{ border: "2px dashed var(--line-dashed)", padding: "20px", borderRadius: "12px", width: "300px" }}>
          <h3 className="text-xl mb-4">2. The garment</h3>
          <input type="file" onChange={(e) => handleFileChange(e, setGarmentImg)} accept="image/*" />
          {garmentImg && (
            <img 
              src={URL.createObjectURL(garmentImg)} 
              alt="Garment" 
              style={{marginTop: 15, width: "100%", borderRadius: 8, maxHeight: "300px", objectFit: "contain"}}
            />
          )}
        </div>
      </div>

      {/* Кнопка запуска */}
      <button 
        onClick={handleGenerate} 
        disabled={loading}
        style={{
          padding: "15px 50px", 
          fontSize: "18px", 
          fontWeight: "bold",
          backgroundColor: loading ? "var(--line-strong)" : "var(--accent)", 
          color: "var(--surface)", 
          border: "none", 
          borderRadius: "30px",
          cursor: loading ? "not-allowed" : "pointer",
          transition: "all 0.3s"
        }}
      >
        {loading ? "Working… (20–30 seconds)" : "Start try-on"}
      </button>

      {/* Блок результата */}
      {resultImg && (
        <div style={{ marginTop: "40px", borderTop: "1px solid var(--line-2)", paddingTop: "40px" }}>
          <h2 className="text-2xl font-bold mb-4">Your look</h2>
          <img 
            src={resultImg} 
            alt="Result" 
            style={{ 
              maxWidth: "100%", 
              borderRadius: "16px", 
              boxShadow: "var(--shadow-pop)" 
            }} 
          />
        </div>
      )}
    </div>
  );
}

export default TryOnPhoto;