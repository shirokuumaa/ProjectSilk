// client/src/pages/SellerPanel.jsx
import React, { useEffect, useState } from "react";

// единая точка входа API (как и в других файлах)
const API = process.env.REACT_APP_API || "http://localhost:5050";

export default function SellerPanel() {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Clothes");

  const [processedUrl, setProcessedUrl]   = useState(null); // превью (PNG/JPG — как есть или после AI)
  const [processedBlob, setProcessedBlob] = useState(null); // файл для отправки

  const [model3dBlob, setModel3dBlob] = useState(null);     // GLB из AI
  const [user3dFile, setUser3dFile]   = useState(null);     // загруженный вручную GLB
  const [glbUrl, setGlbUrl]           = useState(null);     // objectURL для 3D-просмотра

  const [loading, setLoading]   = useState(false);
  const [making3d, setMaking3d] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  // статус AI
  const [aiOnline, setAiOnline] = useState(null);  // null | true | false
  const [aiHint, setAiHint]     = useState("");

  // чистка objectURL превью
  useEffect(() => {
    return () => { if (processedUrl) URL.revokeObjectURL(processedUrl); };
  }, [processedUrl]);

  // отдельная чистка GLB objectURL — по смене/размонту
  useEffect(() => {
    return () => { if (glbUrl) URL.revokeObjectURL(glbUrl); };
  }, [glbUrl]);

  // создаём/сбрасываем glbUrl при смене model3dBlob
  useEffect(() => {
    if (model3dBlob) {
      setGlbUrl(URL.createObjectURL(model3dBlob));
    } else {
      setGlbUrl(null);
    }
  }, [model3dBlob]);

  // пингуем AI (heavy-only: смотрим на mode === "proxy" и gpu === true)
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(`${API}/api/ai/healthz`, { signal: ctl.signal });
        clearTimeout(t);
        if (aborted) return;

        if (!r.ok) {
          setAiOnline(false);
          setAiHint("AI off: background kept as-is. 3D недоступно.");
          return;
        }

        let info = null;
        try {
          info = await r.json();
        } catch {
          info = null;
        }

        const on = info && info.mode === "proxy" && info.gpu === true;
        setAiOnline(on);
        setAiHint(on ? "" : "AI off: background kept as-is. 3D недоступно.");
      } catch {
        if (aborted) return;
        setAiOnline(false);
        setAiHint("AI off: background kept as-is. 3D недоступно.");
      }
    })();
    return () => { aborted = true; };
  }, []);

  // безопасное удаление фона (heavy-only: если AI off — просто возвращаем оригинал, без лёгких моделей)
  async function tryRemoveBg(file) {
    if (!aiOnline) {
      setAiHint("AI off: background kept as-is.");
      return file;
    }
    try {
      const fd = new FormData();
      fd.append("image", file); // поле обязательно "image"

      const r = await fetch(`${API}/api/ai/remove-background`, {
        method: "POST",
        body: fd,
      });

      // heavy-only: если сервер вернул 503 — считаем, что GPU/модель недоступны
      if (r.status === 503) {
        setAiOnline(false);
        setAiHint("AI temporarily disabled (no GPU); using original background.");
        return file;
      }

      if (!r.ok) throw new Error(`remove-background failed: ${r.status}`);

      const ct  = r.headers.get("content-type") || "";
      const buf = await r.arrayBuffer();

      if (ct.startsWith("image/")) {
        return new Blob([buf], { type: ct });
      } else {
        setAiHint("AI returned non-image; using original.");
        return file;
      }
    } catch (e) {
      console.warn("remove-bg fallback:", e);
      // heavy-only: не переходим на лёгкую модель, просто считаем AI offline
      setAiOnline(false);
      setAiHint("AI unavailable; using original.");
      return file;
    }
  }

  async function handleImageUpload(file) {
    // сбрасываем всё по новой загрузке
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setProcessedUrl(null);
    setProcessedBlob(null);
    setModel3dBlob(null);
    setUser3dFile(null);
    setError("");
    setLoading(true);

    try {
      const blob = await tryRemoveBg(file);
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
    if (!aiOnline) return alert("AI сейчас выключен, 3D-реконструкция недоступна.");

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
      try { payload = await r.json(); } catch { /* может вернуть пусто */ }

      if (!r.ok) {
        const msg = (payload && (payload.error || payload.message)) || `HTTP ${r.status}`;
        throw new Error(msg);
      }

      alert("✅ Товар сохранён! Открой вкладку All Products.");

      // сброс формы
      setTitle("");
      setPrice("");
      if (processedUrl) URL.revokeObjectURL(processedUrl);
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

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 8 }}>👕 Загрузка товара продавцом</h2>

      {/* индикатор AI */}
      <div style={{ margin: "8px 0 16px", fontSize: 13 }}>
        {aiOnline === null && <span>Проверяем AI…</span>}
        {aiOnline === true  && (
          <span style={{ color: "#059669" }}>🟢 AI online (heavy models, GPU)</span>
        )}
        {aiOnline === false && (
          <span style={{ color: "#b45309" }}>
            🟠 AI offline — фон не вырезаем, 3D недоступно
          </span>
        )}
      </div>

      {/* Двухколоночный layout: слева форма, справа превью (2D + 3D) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 380px) minmax(0, 380px)",
          gap: 24,
          alignItems: "flex-start",
          maxWidth: 800
        }}
      >
        {/* Левая колонка — форма */}
        <div>
          <div style={{ margin: "12px 0" }}>
            <label style={{ display: "block", marginBottom: 6 }}>
              Изображение товара
            </label>
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

              <div style={{ marginTop: 4 }}>
                <button
                  onClick={handleMake3D}
                  disabled={making3d || !aiOnline}
                  style={{ padding: "8px 12px" }}
                >
                  {aiOnline
                    ? (making3d ? "Генерирую 3D…" : "🧱 Сгенерировать 3D (GLB)")
                    : "🧱 3D недоступно (AI off)"}
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

        {/* Правая колонка — превью */}
        <div>
          {processedUrl ? (
            <>
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#111827"
                }}
              >
                2D-превью товара
              </div>
              {/* серый фон помогает увидеть прозрачность PNG */}
              <div
                style={{
                  width: "100%",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#e5e7eb",
                  marginBottom: 16
                }}
              >
                <img
                  src={processedUrl}
                  alt="Предпросмотр"
                  style={{ width: "100%", display: "block" }}
                />
              </div>

              <div
                style={{
                  marginBottom: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#111827"
                }}
              >
                3D-превью (GLB)
              </div>

              {!glbUrl && (
                <p style={{ fontSize: 13, color: "#6b7280" }}>
                  Сгенерируй 3D или загрузись готовую модель, чтобы посмотреть её здесь.
                </p>
              )}

              {glbUrl && (
                <>
                  {/* 3D viewer: вращение, зум, авто-вращение */}
                  <div
                    style={{
                      width: "100%",
                      height: 320,
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "#1118270d",
                      border: "1px solid #e5e7eb",
                      marginBottom: 8
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

                  <div style={{ fontSize: 13 }}>
                    <a
                      href={glbUrl}
                      download="model.glb"
                      style={{ fontSize: 13, color: "#2563eb" }}
                    >
                      ⤓ Скачать GLB
                    </a>
                    <span style={{ marginLeft: 8, color: "#6b7280" }}>
                      — можно использовать в AR / на странице товара.
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#6b7280" }}>
              Сначала загрузите изображение товара — здесь появится 2D и 3D-превью.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}