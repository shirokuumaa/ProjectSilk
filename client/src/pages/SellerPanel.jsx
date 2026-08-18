// client/src/pages/SellerPanel.jsx
import React, { useEffect, useState } from "react";
import SizeChartEditor, { serializeSizeChart } from "../components/SizeChartEditor";

// единая точка входа API (как и в других файлах)
const API = process.env.REACT_APP_API || "http://localhost:5050";

export default function SellerPanel() {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Clothes");

  const [sizeChart, setSizeChart] = useState([]);
  const [garmentType, setGarmentType] = useState("top");

  const [processedUrl, setProcessedUrl] = useState(null);   // превью (blob URL)
  const [processedBlob, setProcessedBlob] = useState(null); // файл для отправки (Blob/File)

  const [model3dBlob, setModel3dBlob] = useState(null);     // GLB из AI
  const [user3dFile, setUser3dFile] = useState(null);       // загруженный вручную GLB
  const [glbUrl, setGlbUrl] = useState(null);               // objectURL для 3D-просмотра

  const [loading, setLoading] = useState(false);
  const [making3d, setMaking3d] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // статус AI
  const [aiOnline, setAiOnline] = useState(null); // null | true | false
  const [aiHint, setAiHint] = useState("");
  const [aiFeatures, setAiFeatures] = useState(null); // { rembg, triposr, ... } или null

  // чистка objectURL превью (только blob:)
  useEffect(() => {
    return () => {
      if (processedUrl && String(processedUrl).startsWith("blob:")) {
        URL.revokeObjectURL(processedUrl);
      }
    };
  }, [processedUrl]);

  // отдельная чистка GLB objectURL — по смене/размонту
  useEffect(() => {
    return () => {
      if (glbUrl && String(glbUrl).startsWith("blob:")) {
        URL.revokeObjectURL(glbUrl);
      }
    };
  }, [glbUrl]);

  // создаём/сбрасываем glbUrl при смене model3dBlob
  useEffect(() => {
    if (model3dBlob) {
      setGlbUrl(URL.createObjectURL(model3dBlob));
    } else {
      setGlbUrl(null);
    }
  }, [model3dBlob]);

  // 🔍 Проверка AI через /features (самый честный статус)
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);

        const r = await fetch(`${API}/api/ai/features`, { signal: ctl.signal });
        clearTimeout(t);
        if (aborted) return;

        if (!r.ok) {
          setAiOnline(false);
          setAiFeatures(null);
          setAiHint("AI offline — фон не вырезаем, 3D недоступно.");
          return;
        }

        const f = await r.json(); // {rembg:true/false, triposr:true/false, ...}
        setAiFeatures(f);

        // heavy-only: считаем "online" только если rembg реально доступен
        const on = f?.rembg === true;
        setAiOnline(on);
        setAiHint(on ? "" : "AI offline — фон не вырезаем, 3D недоступно.");
      } catch (e) {
        if (aborted) return;
        setAiOnline(false);
        setAiFeatures(null);
        setAiHint("AI offline — фон не вырезаем, 3D недоступно.");
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // ✅ remove-background: POST -> {image_url} -> GET png
  // heavy-only: если AI off — возвращаем оригинал, без лёгких моделей
  async function tryRemoveBg(file) {
    if (!aiOnline) {
      setAiHint("AI off: background kept as-is.");
      return file;
    }

    const fd = new FormData();
    fd.append("image", file); // поле обязательно "image"

    const r = await fetch(`${API}/api/ai/remove-background`, {
      method: "POST",
      body: fd,
    });

    if (r.status === 503) {
      setAiOnline(false);
      setAiHint("AI temporarily disabled (no GPU); using original background.");
      return file;
    }
    if (!r.ok) throw new Error(`remove-background failed: ${r.status}`);

    const j = await r.json(); // {"image_url":"/static/bg/...png"}
    const imageUrl = j?.image_url;
    if (!imageUrl) throw new Error("No image_url returned from AI");

    // качаем png через Node-прокси: /api/ai + image_url
    const imgResp = await fetch(`${API}/api/ai${imageUrl}`);
    if (!imgResp.ok) throw new Error(`failed to fetch processed image: ${imgResp.status}`);

    const blob = await imgResp.blob(); // image/png
    return blob;
  }

  async function handleImageUpload(file) {
    // сбрасываем всё по новой загрузке
    if (processedUrl && String(processedUrl).startsWith("blob:")) {
      URL.revokeObjectURL(processedUrl);
    }
    setProcessedUrl(null);
    setProcessedBlob(null);
    setModel3dBlob(null);
    setUser3dFile(null);
    setError("");
    setLoading(true);

    try {
      const blob = await tryRemoveBg(file);

      // blob может быть File (оригинал) или Blob (после AI)
      setProcessedBlob(blob);
      setProcessedUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      setError("Не удалось обработать изображение. Попробуй другое.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMake3D() {
    if (!processedBlob) return alert("Сначала загрузите изображение и дождитесь обработки.");

    // heavy-only: если AI off или TripoSR off — 3D нельзя
    if (!aiOnline) return alert("AI сейчас выключен, 3D-реконструкция недоступна.");
    if (!(aiFeatures?.triposr === true)) {
      return alert("TripoSR сейчас выключен (triposr:false). 3D пока недоступно.");
    }

    setMaking3d(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", processedBlob, "product.png");

      const r = await fetch(`${API}/api/ai/triposr`, { method: "POST", body: fd });

      if (r.status === 503) {
        setAiOnline(false);
        setError("3D-реконструкция временно недоступна (AI off).");
        return;
      }

      if (!r.ok) throw new Error(`triposr failed: ${r.status}`);

      const ab = await r.arrayBuffer();
      setModel3dBlob(new Blob([ab], { type: "model/gltf-binary" }));
      alert("✅ 3D-модель (GLB) готова. Её можно покрутить и сохранить вместе c товаром.");
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
      fd.append("category", category);
      fd.append("garmentType", garmentType);
      fd.append("sizeChart", JSON.stringify(serializeSizeChart(sizeChart)));
      fd.append("image", processedBlob, "product.png");

      // приоритет у файла, загруженного пользователем
      const modelToSend = user3dFile ?? model3dBlob;
      if (modelToSend) {
        fd.append(
          "model3d",
          modelToSend,
          user3dFile ? (user3dFile.name || "model.glb") : "model.glb"
        );
      }

      const r = await fetch(`${API}/api/products`, { method: "POST", body: fd });
      let payload = null;
      try {
        payload = await r.json();
      } catch {
        payload = null;
      }

      if (!r.ok) {
        const msg = (payload && (payload.error || payload.message)) || `HTTP ${r.status}`;
        throw new Error(msg);
      }

      alert("✅ Товар сохранён! Открой вкладку All Products.");

      // сброс формы
      setTitle("");
      setPrice("");
      setSizeChart([]);

      if (processedUrl && String(processedUrl).startsWith("blob:")) {
        URL.revokeObjectURL(processedUrl);
      }
      setProcessedUrl(null);
      setProcessedBlob(null);

      setModel3dBlob(null);
      setUser3dFile(null);
      setGlbUrl(null);
      setAiHint("");
    } catch (e) {
      console.error(e);
      setError(`Ошибка сохранения товара: ${String(e.message || e)}`);
    } finally {
      setSaving(false);
    }
  }

  const canMake3D = aiOnline === true && aiFeatures?.triposr === true;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 8 }}>👕 Загрузка товара продавцом</h2>

      {/* индикатор AI */}
      <div style={{ margin: "8px 0 16px", fontSize: 13 }}>
        {aiOnline === null && <span>Проверяем AI…</span>}
        {aiOnline === true && (
          <span style={{ color: "#059669" }}>🟢 AI online (heavy models, GPU)</span>
        )}
        {aiOnline === false && (
          <span style={{ color: "#b45309" }}>🟠 AI offline — фон не вырезаем, 3D недоступно</span>
        )}
      </div>

      {/* Двухколоночный layout: слева форма, справа превью (2D + 3D) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 24,
          maxWidth: 900,
        }}
      >
        {/* Основная колонка — форма */}
        <div>
          <div style={{ margin: "12px 0" }}>
            <label style={{ display: "block", marginBottom: 6 }}>Изображение товара</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
            />
            {aiHint && (
              <small style={{ color: "#6b7280", display: "block", marginTop: 6 }}>
                {aiHint}
              </small>
            )}
          </div>

          {loading && <p>⏳ Обрабатываем изображение…</p>}
          {error && <p style={{ color: "crimson" }}>{error}</p>}

          {/* Остальная форма показывается после выбора изображения */}
          {processedUrl && (
            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название товара"
              />
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="0"
                placeholder="Цена"
              />
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option>Clothes</option>
                <option>Home</option>
                <option>Electronics</option>
              </select>

              {/* Компонент размерной сетки */}
              <SizeChartEditor
                value={sizeChart}
                onChange={setSizeChart}
                garmentType={garmentType}
                onGarmentTypeChange={setGarmentType}
              />

              <div style={{ marginTop: 4 }}>
                <button
                  onClick={handleMake3D}
                  disabled={making3d || !canMake3D}
                  style={{ padding: "8px 12px" }}
                >
                  {canMake3D
                    ? (making3d ? "Генерирую 3D…" : "🧱 Сгенерировать 3D (GLB)")
                    : "🧱 3D недоступно (TripoSR off)"}
                </button>
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

              {glbUrl && (
                <div
                  style={{
                    width: "100%",
                    height: 320,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#1118270d",
                    border: "1px solid #e5e7eb",
                    marginBottom: 8,
                  }}
                >
                  <model-viewer
                    src={glbUrl}
                    alt="3D preview"
                    camera-controls
                    auto-rotate
                    autoplay
                    exposure="0.9"
                    style={{ width: "100%", height: "100%" }}
                  ></model-viewer>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                style={{ marginTop: 8, padding: "8px 12px" }}
              >
                {saving ? "Сохраняю…" : "💾 Сохранить в БД"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}