// client/src/assistant/api.js
// Единая точка доступа к API ассистента/каталога

const KEY_BASE = "psilk_api_base";
export function getBaseURL() {
  return localStorage.getItem(KEY_BASE) || "http://127.0.0.1:8000";
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