// client/src/pages/SellerPanel.jsx
//
// Кабинет продавца. Доступ решает сервер (роль seller), здесь — только
// понятный экран для гостя и покупателя. Все запросы — через authFetch.
// Весь текст интерфейса — на английском, цвета — из styles/tokens.css.
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SizeChartEditor, { serializeSizeChart } from "../components/SizeChartEditor";
import SellerHeader from "../components/SellerHeader";
import { authFetch, becomeSeller, fetchMe, isLoggedIn } from "../utils/auth";

// единая точка входа API (как и в других файлах)
const API = process.env.REACT_APP_API || "http://localhost:5050";
const toPublicUrl = (s = "") => (String(s).startsWith("/uploads") ? `${API}${s}` : s);

// те же ограничения, что на сервере (utils/uploadChecks.js) — чтобы ругаться до отправки
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_MB = 10;
const MAX_MODEL_MB = 50;

const AI_OFF_HINT = "AI is offline — the background is kept as is and 3D is unavailable.";

async function errorMessage(r, fallback) {
  const j = await r.json().catch(() => null);
  return j?.message || j?.error || `${fallback} (HTTP ${r.status})`;
}

/* ───────────────────────── доступ ───────────────────────── */

export default function SellerPanel() {
  const nav = useNavigate();
  const [access, setAccess] = useState("loading"); // loading | guest | buyer | seller
  const [me, setMe] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const user = isLoggedIn() ? await fetchMe().catch(() => null) : null;
      if (!alive) return;
      setMe(user);
      setAccess(!user ? "guest" : user.role === "seller" ? "seller" : "buyer");
    })();
    return () => { alive = false; };
  }, []);

  if (access === "loading") {
    return (
      <>
        <SellerHeader />
        <div style={ui.page}><p style={ui.muted}>Checking your account…</p></div>
      </>
    );
  }

  if (access === "guest") {
    return (
      <>
      <SellerHeader />
      <div style={ui.page}>
        <div style={ui.gate}>
          <h2 style={ui.h2}>Seller dashboard</h2>
          <p style={ui.muted}>Sign in with a seller account to open the seller dashboard.</p>
          <div style={ui.row}>
            <button style={ui.btnDark} onClick={() => nav("/login")}>Sign in</button>
            <button style={ui.btn} onClick={() => nav("/register?as=seller")}>Create seller account</button>
          </div>
        </div>
      </div>
      </>
    );
  }

  if (access === "buyer") {
    return (
      <>
        <SellerHeader username={me?.username} />
        <div style={ui.page}>
          <BecomeSeller
            username={me?.username}
            onDone={(user) => { setMe(user); setAccess("seller"); }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <SellerHeader username={me?.username} storeName={me?.storeName} />
      <SellerDashboard />
    </>
  );
}

function BecomeSeller({ username, onDone }) {
  const [storeName, setStoreName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (storeName.trim().length < 2) {
      setError("Please enter your store name (at least 2 characters).");
      return;
    }
    setBusy(true);
    try {
      onDone(await becomeSeller(storeName));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={ui.gate} onSubmit={submit}>
      <h2 style={ui.h2}>Seller dashboard</h2>
      <p style={ui.muted}>
        The seller dashboard is for seller accounts. You are signed in
        as <b>{username}</b>, a buyer account.
      </p>
      <p style={ui.muted}>Open a store to start selling — your account stays the same.</p>
      <input
        style={ui.input}
        placeholder="Store name"
        value={storeName}
        onChange={(e) => setStoreName(e.target.value)}
      />
      {error && <p role="alert" style={ui.error}>{error}</p>}
      <div style={ui.row}>
        <button type="submit" style={ui.btnDark} disabled={busy}>
          {busy ? "Opening…" : "Become a seller"}
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────── кабинет ───────────────────────── */

function SellerDashboard() {
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
  const [notice, setNotice] = useState("");
  const [listKey, setListKey] = useState(0); // смена — перечитать «My products»

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

        const r = await authFetch(`${API}/api/ai/features`, { signal: ctl.signal });
        clearTimeout(t);
        if (aborted) return;

        if (!r.ok) {
          setAiOnline(false);
          setAiFeatures(null);
          setAiHint(AI_OFF_HINT);
          return;
        }

        const f = await r.json(); // {rembg:true/false, triposr:true/false, ...}
        setAiFeatures(f);

        // heavy-only: считаем "online" только если rembg реально доступен
        const on = f?.rembg === true;
        setAiOnline(on);
        setAiHint(on ? "" : AI_OFF_HINT);
      } catch (e) {
        if (aborted) return;
        setAiOnline(false);
        setAiFeatures(null);
        setAiHint(AI_OFF_HINT);
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
      setAiHint("AI is off — the background is kept as is.");
      return file;
    }

    const fd = new FormData();
    fd.append("image", file); // поле обязательно "image"

    const r = await authFetch(`${API}/api/ai/remove-background`, {
      method: "POST",
      body: fd,
    });

    if (r.status === 503) {
      setAiOnline(false);
      setAiHint("AI is temporarily off (no GPU) — the original background is kept.");
      return file;
    }
    if (r.status === 429) {
      setAiHint(await errorMessage(r, "AI limit reached"));
      return file;
    }
    if (!r.ok) throw new Error(`remove-background failed: ${r.status}`);

    const j = await r.json(); // {"image_url":"/static/bg/...png"}
    const imageUrl = j?.image_url;
    if (!imageUrl) throw new Error("No image_url returned from AI");

    // качаем png через Node-прокси: /api/ai + image_url
    const imgResp = await authFetch(`${API}/api/ai${imageUrl}`);
    if (!imgResp.ok) throw new Error(`failed to fetch processed image: ${imgResp.status}`);

    return imgResp.blob(); // image/png
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
    setNotice("");

    if (!IMAGE_TYPES.includes(file.type)) {
      setError("The image must be a JPEG, PNG or WebP file.");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(`The image is too large (maximum ${MAX_IMAGE_MB} MB).`);
      return;
    }

    setLoading(true);
    try {
      const blob = await tryRemoveBg(file);

      // blob может быть File (оригинал) или Blob (после AI)
      setProcessedBlob(blob);
      setProcessedUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      setError("Could not process the image. Please try another one.");
    } finally {
      setLoading(false);
    }
  }

  function handleModelPick(file) {
    setError("");
    if (!file) return setUser3dFile(null);
    if (!file.name.toLowerCase().endsWith(".glb")) {
      setUser3dFile(null);
      return setError("The 3D model must be a .glb file.");
    }
    if (file.size > MAX_MODEL_MB * 1024 * 1024) {
      setUser3dFile(null);
      return setError(`The 3D model is too large (maximum ${MAX_MODEL_MB} MB).`);
    }
    setUser3dFile(file);
  }

  async function handleMake3D() {
    if (!processedBlob) {
      setError("Upload an image first and wait until it is processed.");
      return;
    }

    // heavy-only: если AI off или TripoSR off — 3D нельзя
    if (!aiOnline) return setError("AI is off right now, so 3D reconstruction is unavailable.");
    if (!(aiFeatures?.triposr === true)) {
      return setError("3D reconstruction (TripoSR) is turned off right now.");
    }

    setMaking3d(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", processedBlob, "product.png");

      const r = await authFetch(`${API}/api/ai/triposr`, { method: "POST", body: fd });

      if (r.status === 503) {
        setAiOnline(false);
        setError("3D reconstruction is temporarily unavailable (AI is off).");
        return;
      }
      if (!r.ok) throw new Error(await errorMessage(r, "3D reconstruction failed"));

      const ab = await r.arrayBuffer();
      setModel3dBlob(new Blob([ab], { type: "model/gltf-binary" }));
      setNotice("The 3D model (GLB) is ready. Rotate it to check, then save it with the product.");
    } catch (e) {
      console.error(e);
      setError(e.message || "3D reconstruction failed.");
    } finally {
      setMaking3d(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !price || !processedBlob) {
      setError("Please fill in the title and price and add an image.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("price", String(Number(price)));
      fd.append("category", category);
      fd.append("garmentType", garmentType);
      fd.append("sizeChart", JSON.stringify(serializeSizeChart(sizeChart)));
      // имя файла задаёт расширение на сервере; у исходного File оно своё (jpg/webp)
      fd.append("image", processedBlob, processedBlob.name || "product.png");

      // приоритет у файла, загруженного пользователем
      const modelToSend = user3dFile ?? model3dBlob;
      if (modelToSend) {
        fd.append("model3d", modelToSend, user3dFile ? user3dFile.name : "model.glb");
      }

      const r = await authFetch(`${API}/api/products`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await errorMessage(r, "Could not save the product"));

      setNotice("Product saved. It is now in the catalogue and in “My products” below.");
      setListKey((k) => k + 1);

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
      setError(`Could not save the product: ${String(e.message || e)}`);
    } finally {
      setSaving(false);
    }
  }

  const canMake3D = aiOnline === true && aiFeatures?.triposr === true;

  return (
    <div style={ui.page}>
      <h2 style={{ ...ui.h2, marginBottom: 4 }}>👕 Add a product</h2>

      {/* индикатор AI */}
      <div style={{ margin: "8px 0 16px", fontSize: 13 }}>
        {aiOnline === null && <span style={ui.muted}>Checking AI…</span>}
        {aiOnline === true && (
          <span style={{ color: "var(--fit-good)" }}>🟢 AI online (GPU models)</span>
        )}
        {aiOnline === false && (
          <span style={{ color: "var(--fit-warn)" }}>🟠 {AI_OFF_HINT}</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 24, maxWidth: 900 }}>
        {/* Основная колонка — форма */}
        <div>
          <div style={{ margin: "12px 0" }}>
            <label style={{ display: "block", marginBottom: 6 }}>Product image (JPEG, PNG or WebP, up to {MAX_IMAGE_MB} MB)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
            />
            {aiHint && (
              <small style={{ ...ui.muted, display: "block", marginTop: 6 }}>
                {aiHint}
              </small>
            )}
          </div>

          {loading && <p>⏳ Processing the image…</p>}
          {error && <p role="alert" style={ui.error}>{error}</p>}
          {notice && <p role="status" style={{ color: "var(--fit-good)" }}>{notice}</p>}

          {/* Остальная форма показывается после выбора изображения */}
          {processedUrl && (
            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              <img src={processedUrl} alt="Product preview" style={ui.preview} />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Product title"
              />
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="0"
                placeholder="Price, ₸"
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
                    ? (making3d ? "Generating 3D…" : "🧱 Generate 3D (GLB)")
                    : "🧱 3D unavailable (AI is off)"}
                </button>
              </div>

              <div style={{ marginTop: 6 }}>
                <label style={{ display: "block", marginBottom: 6 }}>
                  Or upload a ready 3D model (.glb, up to {MAX_MODEL_MB} MB, optional)
                </label>
                <input
                  type="file"
                  accept=".glb,model/gltf-binary"
                  onChange={(e) => handleModelPick(e.target.files?.[0] || null)}
                />
                {user3dFile && (
                  <small style={{ ...ui.muted, display: "block", marginTop: 6 }}>
                    Selected: {user3dFile.name} ({(user3dFile.size / 1024 / 1024).toFixed(2)} MB)
                  </small>
                )}
                {!user3dFile && !model3dBlob && (
                  <small style={{ ...ui.muted, display: "block", marginTop: 6 }}>
                    Without a 3D model buyers can still check their size, but cannot try the item on.
                  </small>
                )}
              </div>

              {glbUrl && (
                <div style={ui.viewer}>
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
                {saving ? "Saving…" : "💾 Save product"}
              </button>
            </div>
          )}
        </div>
      </div>

      <MyProducts reloadKey={listKey} />
    </div>
  );
}

/* ───────────────────────── мои товары ───────────────────────── */

function MyProducts({ reloadKey }) {
  const [items, setItems] = useState(null); // null — ещё грузим
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await authFetch(`${API}/api/products/mine`);
      if (!r.ok) throw new Error(await errorMessage(r, "Could not load your products"));
      setItems(await r.json());
    } catch (e) {
      setItems([]);
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  const remove = async (p) => {
    if (!window.confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
    setDeletingId(p._id);
    setError("");
    try {
      const r = await authFetch(`${API}/api/products/${p._id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await errorMessage(r, "Could not delete the product"));
      setItems((list) => list.filter((x) => x._id !== p._id));
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section style={{ marginTop: 32, maxWidth: 900 }}>
      <h3 style={ui.h3}>My products{items ? ` · ${items.length}` : ""}</h3>
      {error && <p role="alert" style={ui.error}>{error}</p>}
      {items === null && <p style={ui.muted}>Loading…</p>}
      {items?.length === 0 && !error && (
        <p style={ui.muted}>You have no products yet. Add your first one above.</p>
      )}
      {items?.map((p) => (
        <div key={p._id} style={ui.item}>
          <img src={toPublicUrl(p.image)} alt="" style={ui.thumb} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, color: "var(--ink)" }}>{p.title}</div>
            <div style={ui.meta}>
              {Number(p.price || 0).toLocaleString("en-US")} ₸ · {p.garmentType || "top"}
              {" · "}{p.sizeChart?.length ? `${p.sizeChart.length} sizes` : "no size chart"}
              {" · "}{p.model3d ? "3D model" : "no 3D model"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={ui.btn}
              onClick={() => setEditingId(editingId === p._id ? null : p._id)}
              aria-expanded={editingId === p._id}
            >
              {editingId === p._id ? "Close" : "Edit"}
            </button>
            <button
              style={ui.btnDanger}
              onClick={() => remove(p)}
              disabled={deletingId === p._id}
            >
              {deletingId === p._id ? "Deleting…" : "Delete"}
            </button>
          </div>
          {editingId === p._id && (
            <EditProductForm
              product={p}
              onCancel={() => setEditingId(null)}
              onSaved={(updated) => {
                setItems((list) => list.map((x) => (x._id === updated._id ? updated : x)));
                setEditingId(null);
              }}
            />
          )}
        </div>
      ))}
    </section>
  );
}

/* ───────────────────────── редактирование ───────────────────────── */

// строки сетки с сервера → строки редактора (пустые мерки — '' вместо undefined)
const toEditorRows = (chart = []) =>
  chart.map((r) => ({
    size: r.size,
    chest: r.chest ?? "", waist: r.waist ?? "", hips: r.hips ?? "",
    length: r.length ?? "", sleeve: r.sleeve ?? "",
    fit: r.fit || "regular",
    stretch: r.stretch ?? 0,
  }));

export function EditProductForm({ product, onCancel, onSaved }) {
  const [title, setTitle] = useState(product.title || "");
  const [price, setPrice] = useState(String(product.price ?? ""));
  const [category, setCategory] = useState(product.category || "Clothes");
  const [garmentType, setGarmentType] = useState(product.garmentType || "top");
  const [sizeChart, setSizeChart] = useState(() => toEditorRows(product.sizeChart));
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pickImage = (file) => {
    setError("");
    if (!file) return setImage(null);
    if (!IMAGE_TYPES.includes(file.type)) return setError("The image must be a JPEG, PNG or WebP file.");
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) return setError(`The image is too large (maximum ${MAX_IMAGE_MB} MB).`);
    setImage(file);
  };

  const save = async () => {
    if (!title.trim()) return setError("The title cannot be empty.");
    const priceNum = Number(price);
    if (price === "" || !Number.isFinite(priceNum) || priceNum < 0) return setError("Price must be a positive number.");
    setSaving(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("price", String(priceNum));
      fd.append("category", category);
      fd.append("garmentType", garmentType);
      fd.append("sizeChart", JSON.stringify(serializeSizeChart(sizeChart)));
      if (image) fd.append("image", image, image.name);
      const r = await authFetch(`${API}/api/products/${product._id}`, { method: "PATCH", body: fd });
      if (!r.ok) throw new Error(await errorMessage(r, "Could not save the changes"));
      onSaved(await r.json());
    } catch (e) {
      setError(e instanceof TypeError
        ? "Could not reach the server. Please try again."
        : e.message || "Could not save the changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={ui.editBox}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={ui.label}>
          Title
          <input style={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={ui.label}>
          Price, ₸
          <input style={ui.input} type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label style={ui.label}>
          Category
          <select style={ui.input} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>Clothes</option>
            <option>Home</option>
            <option>Electronics</option>
          </select>
        </label>

        <SizeChartEditor
          value={sizeChart}
          onChange={setSizeChart}
          garmentType={garmentType}
          onGarmentTypeChange={setGarmentType}
        />

        <label style={ui.label}>
          New image (optional; JPEG, PNG or WebP, up to {MAX_IMAGE_MB} MB)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "block", marginTop: 6 }}
            onChange={(e) => pickImage(e.target.files?.[0] || null)}
          />
        </label>

        {error && <p role="alert" style={ui.error}>{error}</p>}

        <div style={ui.row}>
          <button style={ui.btnDark} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button style={ui.btn} onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const ui = {
  page: { padding: 24 },
  h2: { margin: "0 0 12px", color: "var(--ink)" },
  h3: { margin: "0 0 12px", fontSize: 16, color: "var(--ink)" },
  muted: { color: "var(--muted)" },
  error: { color: "var(--fit-bad)" },
  row: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 },
  gate: {
    maxWidth: 520, padding: 20, borderRadius: 12,
    border: "1px solid var(--line)", background: "var(--surface)",
  },
  input: {
    display: "block", width: "100%", boxSizing: "border-box", marginTop: 8,
    padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-strong)",
  },
  btn: {
    padding: "8px 14px", borderRadius: 8, cursor: "pointer",
    border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)",
  },
  btnDark: {
    padding: "8px 14px", borderRadius: 8, cursor: "pointer",
    border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--surface)",
  },
  btnDanger: {
    padding: "6px 12px", borderRadius: 8, cursor: "pointer",
    border: "1px solid var(--fit-bad)", background: "var(--surface)", color: "var(--fit-bad)",
  },
  preview: {
    width: 160, height: 200, objectFit: "contain", borderRadius: 8,
    border: "1px solid var(--line)", background: "var(--surface-3)",
  },
  viewer: {
    width: "100%", height: 320, borderRadius: 12, overflow: "hidden", marginBottom: 8,
    background: "var(--surface-2)", border: "1px solid var(--line)",
  },
  item: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 10, marginBottom: 8,
    borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)",
  },
  thumb: {
    width: 56, height: 70, objectFit: "cover", borderRadius: 6,
    background: "var(--surface-3)", border: "1px solid var(--line-2)",
  },
  meta: { fontSize: 13, color: "var(--muted)", marginTop: 2 },
  editBox: {
    flexBasis: "100%", marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--line)",
  },
  label: { display: "block", fontSize: 13, color: "var(--muted)" },
};
