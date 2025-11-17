// local-first storage for wardrobe & outfits

const LS_ITEMS = 'wardrobeItems';
const LS_OUTFITS = 'wardrobeOutfits';

export function getWardrobe() {
  try { return JSON.parse(localStorage.getItem(LS_ITEMS)) || []; }
  catch { return []; }
}
export function saveWardrobe(items) {
  localStorage.setItem(LS_ITEMS, JSON.stringify(items || []));
}

export function addToWardrobe(item) {
  const cur = getWardrobe();
  const exists = cur.some(x => (x.id || x._id) === (item.id || item._id));
  const now = Date.now();
  const rec = {
    id: item.id || item._id,
    name: item.name || item.title || 'Item',
    image: item.image || item.images?.[0] || item.gallery?.[0] || '',
    category: item.category || 'All',
    price: item.price ?? undefined,
    model3d: item.model3d || undefined,
    colorways: item.colorways || [],
    addedAt: now,
  };
  saveWardrobe(exists ? cur : [...cur, rec]);
  return rec;
}
export function removeFromWardrobe(id) {
  const cur = getWardrobe().filter(x => (x.id || x._id) !== id);
  saveWardrobe(cur);
}

export function clearWardrobe() { saveWardrobe([]); }

export function importFromFavorites() {
  let fav = [];
  try { fav = JSON.parse(localStorage.getItem('favorites') || '[]'); } catch {}
  const mapped = fav.map(f => ({
    id: f.id || f._id,
    name: f.name || 'Item',
    image: f.image,
    category: f.category || 'All',
    price: f.price ?? undefined,
    addedAt: Date.now(),
  }));
  const cur = getWardrobe();
  const merged = [...cur];
  mapped.forEach(m => { if (!merged.some(x => x.id === m.id)) merged.push(m); });
  saveWardrobe(merged);
  return merged.length - cur.length;
}

// outfits (saved looks)
export function getOutfits() {
  try { return JSON.parse(localStorage.getItem(LS_OUTFITS)) || []; }
  catch { return []; }
}
export function saveOutfits(arr) { localStorage.setItem(LS_OUTFITS, JSON.stringify(arr || [])); }
export function addOutfit(outfit) {
  const cur = getOutfits();
  const id = outfit.id || `outfit_${Date.now().toString(36)}`;
  const rec = { ...outfit, id, createdAt: Date.now() };
  saveOutfits([rec, ...cur]);
  return rec;
}