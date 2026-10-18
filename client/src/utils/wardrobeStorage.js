// local-first storage for wardrobe & outfits
//
// Гость: гардероб живёт только в этом браузере.
// Вошедший: источник правды — сервер (/api/wardrobe), localStorage — кэш,
// чтобы страницы читали гардероб синхронно. Каждое изменение дублируется на сервер.
// При выходе кэш стирается (auth.logout), при входе — заполняется с сервера (pullWardrobe).

import { GUEST_WARDROBE_KEY, isLoggedIn } from './auth';
import {
  listWardrobeApi, addWardrobeApi, removeWardrobeApi, clearWardrobeApi,
} from './wardrobeApi';

const LS_ITEMS = 'wardrobeItems';
const LS_OUTFITS = 'wardrobeOutfits';

/** Событие на window: гардероб в кэше заменён (вход, перенос гостевых вещей). */
export const WARDROBE_EVENT = 'wardrobe-changed';

const toServerItem = (rec) => ({
  productId: String(rec.id),
  name: rec.name || 'Item',
  price: rec.price ?? 0,
  image: rec.image || '',
  category: rec.category || 'All',
});

const fromServerItem = (doc) => ({
  id: doc.productId,
  name: doc.name,
  image: doc.image || '',
  category: doc.category || 'All',
  price: doc.price ?? undefined,
  colorways: [],
  addedAt: Date.parse(doc.createdAt) || Date.now(),
});

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
  if (!exists && isLoggedIn()) addWardrobeApi(toServerItem(rec));
  return rec;
}
export function removeFromWardrobe(id) {
  const cur = getWardrobe().filter(x => (x.id || x._id) !== id);
  saveWardrobe(cur);
  if (isLoggedIn()) removeWardrobeApi(String(id));
}

/**
 * Убрать из гардероба вещи, которых нет в каталоге (товар удалён продавцом).
 * Вызывать только с успешно загруженным каталогом: без него не знаем, что удалено.
 * Сервер свои записи чистит сам (при удалении товара и при чтении гардероба).
 * @returns {Array} оставшиеся вещи
 */
export function pruneWardrobe(catalog) {
  const cur = getWardrobe();
  if (!Array.isArray(catalog)) return cur;
  const ids = new Set(catalog.map((p) => String(p?._id || p?.id)));
  const kept = cur.filter((x) => ids.has(String(x.id || x._id)));
  if (kept.length !== cur.length) saveWardrobe(kept);
  return kept;
}

export function clearWardrobe() {
  saveWardrobe([]);
  if (isLoggedIn()) clearWardrobeApi();
}

/**
 * Вошедший пользователь: заменить кэш гардероба серверным.
 * @returns {Promise<boolean>} false — сервер не ответил, кэш не тронут
 */
export async function pullWardrobe() {
  const docs = await listWardrobeApi();
  if (!Array.isArray(docs)) return false;
  // сервер отдаёт новые сверху, в кэше порядок добавления
  saveWardrobe(docs.map(fromServerItem).reverse());
  window.dispatchEvent(new Event(WARDROBE_EVENT));
  return true;
}

/** Вещи, которые гость добавил до входа и которых ещё нет в аккаунте. */
export function getGuestWardrobe() {
  let guest = [];
  try { guest = JSON.parse(localStorage.getItem(GUEST_WARDROBE_KEY) || '[]'); } catch {}
  if (!Array.isArray(guest)) return [];
  const mine = new Set(getWardrobe().map((x) => String(x.id || x._id)));
  return guest.filter((x) => !mine.has(String(x.id || x._id)));
}

export function discardGuestWardrobe() {
  try { localStorage.removeItem(GUEST_WARDROBE_KEY); } catch {}
}

/**
 * Перенести гостевые вещи в аккаунт.
 * @returns {Promise<number>} сколько вещей сохранено на сервере
 */
export async function moveGuestWardrobeToAccount() {
  const guest = getGuestWardrobe();
  let moved = 0;
  for (const rec of guest) {
    if (await addWardrobeApi(toServerItem({ ...rec, id: rec.id || rec._id }))) moved += 1;
  }
  discardGuestWardrobe();
  await pullWardrobe();
  return moved;
}

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
  if (isLoggedIn()) merged.slice(cur.length).forEach((m) => addWardrobeApi(toServerItem(m)));
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