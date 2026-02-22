import React, { useState } from "react";
import axios from "axios";
import { getBaseURL } from "../../assistant/api"; // Берем адрес из нашего api.js

function TryOnPhoto() {
  const [humanImg, setHumanImg] = useState(null); // Фото человека
  const [garmentImg, setGarmentImg] = useState(null); // Фото одежды
  const [resultImg, setResultImg] = useState(null); // Результат от ИИ
  const [loading, setLoading] = useState(false); // Статус загрузки
  
  // 🔥 НОВОЕ: Состояние для категории
  const [category, setCategory] = useState("upper_body"); 

  // Обработчик выбора файла
  const handleFileChange = (e, setFile) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Кнопка "Примерить"
  const handleGenerate = async () => {
    if (!humanImg || !garmentImg) {
      alert("Пожалуйста, загрузи оба фото!");
      return;
    }

    setLoading(true);
    setResultImg(null); 

    try {
      // 1. Готовим данные
      const formData = new FormData();
      formData.append("human", humanImg);
      formData.append("garment", garmentImg);
      
      // 🔥 ВАЖНО: Отправляем выбранную категорию на сервер
      formData.append("category", category);

      // 2. Отправляем на сервер
      const response = await axios.post(`${getBaseURL()}/tryon`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob", 
      });

      // 3. Показываем результат
      const imageUrl = URL.createObjectURL(response.data);
      setResultImg(imageUrl);
      
    } catch (error) {
      console.error("Ошибка:", error);
      alert("Ошибка генерации. Проверь консоль и терминал сервера.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "40px", textAlign: "center", maxWidth: "800px", margin: "0 auto" }}>
      <h1 className="text-3xl font-bold mb-8">✨ Виртуальная Примерка (AI)</h1>
      
      <div style={{ display: "flex", justifyContent: "center", gap: "20px", marginBottom: "20px", flexWrap: "wrap" }}>
        {/* Карточка: Человек */}
        <div style={{ border: "2px dashed #ccc", padding: "20px", borderRadius: "12px", width: "300px" }}>
          <h3 className="text-xl mb-4">1. Твое фото</h3>
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
        <div style={{ border: "2px dashed #ccc", padding: "20px", borderRadius: "12px", width: "300px" }}>
          <h3 className="text-xl mb-4">2. Одежда</h3>
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

      {/* 🔥 НОВЫЙ БЛОК: Выбор категории */}
      <div style={{ marginBottom: "30px", padding: "15px", backgroundColor: "#f9f9f9", borderRadius: "12px", display: "inline-block" }}>
        <label style={{ marginRight: "10px", fontSize: "18px", fontWeight: "bold" }}>Что примеряем?</label>
        <select 
          value={category} 
          onChange={(e) => setCategory(e.target.value)}
          style={{ 
            padding: "10px", 
            fontSize: "16px", 
            borderRadius: "8px", 
            border: "1px solid #ddd",
            cursor: "pointer"
          }}
        >
          <option value="upper_body">👕 Верх (Майки, Кофты)</option>
          <option value="lower_body">👖 Низ (Джинсы, Юбки, Шорты)</option>
          <option value="dresses">👗 Платье (Весь рост)</option>
        </select>
      </div>
      <br/>

      {/* Кнопка запуска */}
      <button 
        onClick={handleGenerate} 
        disabled={loading}
        style={{
          padding: "15px 50px", 
          fontSize: "18px", 
          fontWeight: "bold",
          backgroundColor: loading ? "#ccc" : "#7c3aed", 
          color: "white", 
          border: "none", 
          borderRadius: "30px",
          cursor: loading ? "not-allowed" : "pointer",
          transition: "all 0.3s",
          boxShadow: "0 4px 15px rgba(124, 58, 237, 0.4)"
        }}
      >
        {loading ? "⏳ Шьем одежду... (20-30 сек)" : "🚀 ПРИМЕРИТЬ"}
      </button>

      {/* Блок результата */}
      {resultImg && (
        <div style={{ marginTop: "40px", borderTop: "1px solid #eee", paddingTop: "40px" }}>
          <h2 className="text-2xl font-bold mb-4">✨ Готовый образ:</h2>
          <img 
            src={resultImg} 
            alt="Result" 
            style={{ 
              maxWidth: "100%", 
              borderRadius: "16px", 
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)" 
            }} 
          />
        </div>
      )}
    </div>
  );
}

export default TryOnPhoto;