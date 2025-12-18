// client/src/pages/TripoSRDebug.jsx
import React, { useState } from "react";

const API_BASE = "http://localhost:5050"; // ЯВНО ходим на Node-сервер

const TripoSRDebug = () => {
  const [file, setFile] = useState(null);
  const [glbUrl, setGlbUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [healthText, setHealthText] = useState("");

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setError("");
    setStatus("");
    setHealthText("");
    if (glbUrl) {
      URL.revokeObjectURL(glbUrl);
      setGlbUrl(null);
    }
  };

  const handleHealthCheck = async () => {
    setHealthText("...");
    setError("");
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/api/ai/healthz`);
      const text = await res.text();
      setHealthText(`HTTP ${res.status}\n` + text);
    } catch (err) {
      setHealthText("Ошибка healthz: " + String(err?.message || err));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError("Пожалуйста, выбери картинку сначала.");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus("");
    setHealthText("");

    try {
      const formData = new FormData();
      formData.append("image", file);

      // ВАЖНО: ходим строго на http://localhost:5050, а не на порт 3000
      const res = await fetch(
        `${API_BASE}/api/ai/triposr?resolution=160`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) {
        let msg = `Request failed with status ${res.status}`;
        const ct = res.headers.get("content-type") || "";
        try {
          if (ct.includes("application/json")) {
            const data = await res.json();
            msg = data?.error || data?.message || msg;
          } else {
            const txt = await res.text();
            if (txt) msg = txt;
          }
        } catch {
          // игнорируем, оставляем msg
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setGlbUrl(url);
      setStatus("3D модель сгенерирована ✅");
    } catch (err) {
      console.error("TripoSR debug error:", err);
      setError(String(err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "600", marginBottom: "16px" }}>
        TripoSR Debug · 3D превью
      </h1>

      <p style={{ marginBottom: "16px", lineHeight: 1.5 }}>
        Здесь мы просто проверяем, как TripoSR делает 3D-модель:
        загружаем картинку → отправляем на{" "}
        <code>{API_BASE}/api/ai/triposr</code> → показываем GLB через{" "}
        <code>&lt;model-viewer&gt;</code>. Никакого красивого UX, только отладка.
      </p>

      <form onSubmit={handleSubmit} style={{ marginBottom: "24px" }}>
        <div style={{ marginBottom: "12px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: 500,
            }}
          >
            1. Выбери картинку с одеждой (sample.png и т.п.):
          </label>
          <input type="file" accept="image/*" onChange={handleFileChange} />
        </div>

        <button
          type="submit"
          disabled={!file || isLoading}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: !file || isLoading ? "#ccc" : "#111827",
            color: "white",
            cursor: !file || isLoading ? "not-allowed" : "pointer",
            fontWeight: 500,
            marginRight: "12px",
          }}
        >
          {isLoading ? "Генерация..." : "2. Generate 3D"}
        </button>

        <button
          type="button"
          onClick={handleHealthCheck}
          style={{
            padding: "8px 14px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            backgroundColor: "#f3f4f6",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Проверить /api/ai/healthz
        </button>
      </form>

      {status && (
        <div
          style={{
            marginBottom: "12px",
            padding: "8px 12px",
            borderRadius: "8px",
            backgroundColor: "#ecfdf3",
            color: "#166534",
            fontSize: "14px",
          }}
        >
          {status}
        </div>
      )}

      {healthText && (
        <pre
          style={{
            marginBottom: "12px",
            padding: "8px 12px",
            borderRadius: "8px",
            backgroundColor: "#e0f2fe",
            color: "#0f172a",
            fontSize: "13px",
            whiteSpace: "pre-wrap",
          }}
        >
          {healthText}
        </pre>
      )}

      {error && (
        <div
          style={{
            marginBottom: "12px",
            padding: "8px 12px",
            borderRadius: "8px",
            backgroundColor: "#fef2f2",
            color: "#b91c1c",
            fontSize: "14px",
            whiteSpace: "pre-wrap",
          }}
        >
          Ошибка: {error}
        </div>
      )}

      {glbUrl && (
        <div style={{ marginTop: "24px" }}>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            3D-просмотр:
          </h2>

          <model-viewer
            src={glbUrl}
            camera-controls
            auto-rotate
            rotation-per-second="30deg"
            exposure="1"
            shadow-intensity="1"
            style={{
              width: "100%",
              maxWidth: "480px",
              height: "480px",
              background: "#f3f4f6",
              borderRadius: "16px",
              border: "1px solid #e5e7eb",
            }}
          ></model-viewer>

          <p
            style={{
              marginTop: "8px",
              fontSize: "12px",
              color: "#6b7280",
              wordBreak: "break-all",
            }}
          >
            Временный glbUrl (blob): {glbUrl}
          </p>
        </div>
      )}
    </div>
  );
};

export default TripoSRDebug;