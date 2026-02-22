// client/src/assistant/api.js
// Единая точка доступа к API ассистента/каталога

const KEY_BASE = "psilk_api_base";

export function getBaseURL() {
  // ✅ ТВОЯ НОВАЯ ССЫЛКА (ТУННЕЛЬ):
  return "https://7b426d44d09f83.lhr.life";
}

export function setBaseURL(u) {
  if (typeof u === "string" && u.trim()) localStorage.setItem(KEY_BASE, u.trim());
}

// session id (персистим между перезагрузками)
export function getSessionId() {
  const k = "lunbee_session";
  let s = null;
  try { s = localStorage.getItem(k); } catch {}
  if (!s) {
    s = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(k, s); } catch {}
  }
  return s;
}

// helper: аккуратная обработка ошибок
async function toJSON(res) {
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return res.json();
}

// ---------- catalog / cart / compare ----------
export async function searchProducts(body = {}) {
  const payload = {
    query: "",
    filters: {},
    sort: "relevance",   // relevance | price_asc | price_desc
    limit: 12,
    offset: 0,
    ...body,
  };
  const r = await fetch(`${getBaseURL()}/api/products/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return toJSON(r);
}

export async function addToCart({ session_id, product_id, size, qty }) {
  const r = await fetch(`${getBaseURL()}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, product_id, size, qty }),
  });
  return toJSON(r);
}

export async function getCart(session_id) {
  const r = await fetch(
    `${getBaseURL()}/api/cart?session_id=${encodeURIComponent(session_id)}`
  );
  return toJSON(r);
}

export async function checkout({ session_id, payment_method = "credit_card" }) {
  const r = await fetch(`${getBaseURL()}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, payment_method }),
  });
  return toJSON(r);
}

export async function compareProducts(ids = []) {
  const r = await fetch(
    `${getBaseURL()}/api/compare?ids=${encodeURIComponent(ids.join(","))}`
  );
  return toJSON(r);
}

// ---------- prefs (память пользователя) ----------
export async function getPrefs(session_id) {
  const r = await fetch(
    `${getBaseURL()}/api/prefs?session_id=${encodeURIComponent(session_id)}`
  );
  return toJSON(r);
}

export async function setPrefs(session_id, json) {
  const r = await fetch(`${getBaseURL()}/api/prefs/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, json }),
  });
  return toJSON(r);
}

// ---------- health ----------
export async function health() {
  const r = await fetch(`${getBaseURL()}/healthz`);
  return toJSON(r);
}

// ==========================================
// 🔥 НОВАЯ ФУНКЦИЯ ДЛЯ ВИРТУАЛЬНОЙ ПРИМЕРКИ
// ==========================================
export async function tryOn({ human, garment }) {
  // 1. Создаем форму, как для отправки файлов
  const formData = new FormData();

  // 2. Добавляем фото человека (React Native формат)
  formData.append("human", {
    uri: human.uri,       // путь к файлу на телефоне
    name: "human.jpg",    // имя файла
    type: "image/jpeg",   // тип файла
  });

  // 3. Добавляем фото одежды
  formData.append("garment", {
    uri: garment.uri,
    name: "garment.jpg",
    type: "image/jpeg",
  });

  console.log("🚀 Sending TryOn request to:", `${getBaseURL()}/tryon`);

  // 4. Отправляем запрос на Python сервер
  const response = await fetch(`${getBaseURL()}/tryon`, {
    method: "POST",
    body: formData,
    headers: {
      // Важно: Content-Type здесь НЕ указываем, React Native сам подставит multipart/form-data
      "Accept": "application/json",
    },
  });

  // 5. Проверяем ошибки
  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ TryOn Error:", errorText);
    throw new Error(`TryOn Failed: ${response.status} ${errorText}`);
  }

  // 6. Получаем картинку (Blob) и превращаем в Base64 для отображения
  const blob = await response.blob();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result); // Вернет строку "data:image/png;base64,..."
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}