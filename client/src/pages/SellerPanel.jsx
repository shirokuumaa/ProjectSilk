// client/src/pages/SellerPanel.jsx
import React, { useEffect, useState } from "react";

// если сервер на другом порту — укажи его здесь
const API = "http://localhost:5050";

export default function SellerPanel() {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  const [processedUrl, setProcessedUrl] = useState(null);   // превью PNG с альфой
  const [processedBlob, setProcessedBlob] = useState(null); // PNG для отправки

  const [model3dBlob, setModel3dBlob] = useState(null);     // GLB из AI
  const [user3dFile, setUser3dFile] = useState(null);       // загруженный вручную GLB
  const [glbUrl, setGlbUrl] = useState(null);

  const [loading, setLoading] = useState(false);
  const [making3d, setMaking3d] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // чистим objectURL, чтобы не текла память
  useEffect(() => () => { if (processedUrl) URL.revokeObjectURL(processedUrl); }, [processedUrl]);
  useEffect(() => {
    if (glbUrl) URL.revokeObjectURL(glbUrl);
    if (model3dBlob) setGlbUrl(URL.createObjectURL(model3dBlob));
    else setGlbUrl(null);
  }, [model3dBlob]);

  async function removeBg(file) {
    const fd = new FormData();
    fd.append("image", file);                      // ВАЖНО: имя поля — "image"
    const r = await fetch(`${API}/api/ai/remove-background`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) throw new Error(`remove-background failed: ${r.status}`);
    const buf = await r.arrayBuffer();
    return new Blob([buf], { type: "image/png" }); // сервер отдаёт PNG с прозрачным фоном
  }

  async function handleImageUpload(file) {
    // сбрасываем предыдущее
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setProcessedUrl(null);
    setProcessedBlob(null);
    setModel3dBlob(null);
    setUser3dFile(null);
    setError("");
    setLoading(true);

    try {
      const blob = await removeBg(file);
      setProcessedBlob(blob);
      setProcessedUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      setError("Не удалось вырезать фон. Попробуй другое изображение.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMake3D() {
    if (!processedBlob) return alert("Сначала загрузите изображение и дождитесь удаления фона.");
    setMaking3d(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", processedBlob, "product.png");
      const r = await fetch(`${API}/api/ai/triposr`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`triposr failed: ${r.status}`);
      const ab = await r.arrayBuffer();
      setModel3dBlob(new Blob([ab], { type: "model/gltf-binary" }));
    } catch (e) {
      console.error(e);
      setError("3D-реконструкция не удалась.");
    } finally {
      setMaking3d(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !price || !processedBlob) {
      return alert("Заполни название, цену и добавь изображение.");
    }
    setSaving(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("price", String(Number(price)));
      fd.append("image", processedBlob, "product.png");

      // если пользователь выбрал свой GLB — он в приоритете
      const modelToSend = user3dFile ?? model3dBlob;
      if (modelToSend) {
        fd.append("model3d", modelToSend, user3dFile ? (user3dFile.name || "model.glb") : "model.glb");
      }

      const r = await fetch(`${API}/api/products`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      await r.json();

      alert("✅ Товар сохранён! Открой вкладку All Products.");
      // сброс формы
      setTitle("");
      setPrice("");
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      setProcessedUrl(null);
      setProcessedBlob(null);
      setModel3dBlob(null);
      setUser3dFile(null);
    } catch (e) {
      console.error(e);
      setError("Ошибка сохранения товара.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <h2>👕 Загрузка товара продавцом</h2>

      <div style={{ margin: "12px 0" }}>
        <label style={{ display: "block", marginBottom: 6 }}>Изображение товара</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
      </div>

      {loading && <p>⏳ Обрабатываем изображение…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {processedUrl && (
        <>
          {/* серый фон помогает увидеть прозрачность PNG */}
          <img
            src={processedUrl}
            alt="PNG без фона"
            style={{ width: "100%", borderRadius: 8, marginTop: 8, background: "#eee" }}
          />

          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название товара" />
            <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" placeholder="Цена" />

            <div>
              <button onClick={handleMake3D} disabled={making3d}>
                {making3d ? "Генерирую 3D…" : "🧱 Сгенерировать 3D (GLB)"}
              </button>
              {glbUrl && (
                <a href={glbUrl} download="model.glb" style={{ marginLeft: 10, fontSize: 14 }}>
                  ⤓ Скачать GLB
                </a>
              )}
            </div>

            <div style={{ marginTop: 6 }}>
              <label style={{ display: "block", marginBottom: 6 }}>
                Или загрузить готовую 3D-модель (опционально)
              </label>
              <input
                type="file"
                accept=".glb,.gltf,.obj,.fbx,.usdz"
                onChange={(e) => setUser3dFile(e.target.files?.[0] || null)}
              />
              {user3dFile && (
                <small style={{ display: "block", marginTop: 6, color: "#555" }}>
                  Выбрано: {user3dFile.name} ({(user3dFile.size / 1024 / 1024).toFixed(2)} MB)
                </small>
              )}
            </div>

            <button onClick={handleSave} disabled={saving}>
              {saving ? "Сохраняю…" : "💾 Сохранить в БД"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}