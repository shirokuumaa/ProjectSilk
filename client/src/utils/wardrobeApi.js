// client/src/utils/wardrobeApi.js
// Серверный гардероб. Пользователь определяется по токену (authFetch).
import { authFetch, isLoggedIn } from './auth';

const API = process.env.REACT_APP_API || 'http://localhost:5050';

export async function listWardrobeApi() {
  if (!isLoggedIn()) return null;
  try {
    const r = await authFetch(`${API}/api/wardrobe`);
    if (!r.ok) throw new Error('list failed');
    return await r.json();
  } catch { return null; }
}

export async function addWardrobeApi(item) {
  if (!isLoggedIn()) return null;
  try {
    const r = await authFetch(`${API}/api/wardrobe`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(item),
    });
    return r.ok;
  } catch { return false; }
}

export async function removeWardrobeApi(productId) {
  if (!isLoggedIn()) return null;
  try {
    const r = await authFetch(`${API}/api/wardrobe/${encodeURIComponent(productId)}`, {
      method: 'DELETE'
    });
    return r.ok;
  } catch { return false; }
}

export async function clearWardrobeApi() {
  if (!isLoggedIn()) return null;
  try {
    const r = await authFetch(`${API}/api/wardrobe`, { method:'DELETE' });
    return r.ok;
  } catch { return false; }
}
