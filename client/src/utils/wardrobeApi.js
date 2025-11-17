// client/src/utils/wardrobeApi.js
const API = process.env.REACT_APP_API || 'http://localhost:5050';
const U = () => localStorage.getItem('loggedInUser') || '';

export async function listWardrobeApi() {
  const user = U(); if (!user) return null;
  try {
    const r = await fetch(`${API}/api/wardrobe?user=${encodeURIComponent(user)}`);
    if (!r.ok) throw new Error('list failed');
    return await r.json();
  } catch { return null; }
}

export async function addWardrobeApi(item) {
  const user = U(); if (!user) return null;
  try {
    const r = await fetch(`${API}/api/wardrobe?user=${encodeURIComponent(user)}`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(item),
    });
    return r.ok;
  } catch { return false; }
}

export async function removeWardrobeApi(productId) {
  const user = U(); if (!user) return null;
  try {
    const r = await fetch(`${API}/api/wardrobe/${encodeURIComponent(productId)}?user=${encodeURIComponent(user)}`, {
      method: 'DELETE'
    });
    return r.ok;
  } catch { return false; }
}

export async function clearWardrobeApi() {
  const user = U(); if (!user) return null;
  try {
    const r = await fetch(`${API}/api/wardrobe?user=${encodeURIComponent(user)}`, { method:'DELETE' });
    return r.ok;
  } catch { return false; }
}