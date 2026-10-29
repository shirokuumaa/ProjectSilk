// server/utils/productDetails.js
//
// Поля карточки товара для покупателя: галерея, описание, состав ткани, уход, страна
// производства, остаток по размерам. Разбор формы продавца; тексты ошибок видит продавец.

/** Сколько фото в галерее, кроме главного. */
export const MAX_GALLERY = 8;

const LIMITS = {
  description: [4000, 'Description'],
  care: [1000, 'Care instructions'],
  countryOfOrigin: [60, 'Country of origin'],
};

/**
 * Текстовое поле: undefined — не передано, '' — очистить (undefined в товаре), иначе строка.
 * @returns {{ value?: string, error?: string, skip?: boolean }}
 */
export function parseText(field, raw) {
  if (raw === undefined) return { skip: true };
  const value = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  const [max, label] = LIMITS[field];
  if (value.length > max) return { error: `${label} is too long (maximum ${max} characters).` };
  return { value: value || undefined };
}

/**
 * Состав ткани: JSON [{ fibre, percent }]. Пусто — без состава.
 * Проценты — от 0,1 до 100, вместе — 100 (как на бирке).
 * @returns {{ composition?: Array, error?: string, skip?: boolean }}
 */
export function parseComposition(raw) {
  if (raw === undefined) return { skip: true };
  if (raw === '' || raw === null) return { composition: undefined };
  let list;
  try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { list = null; }
  if (!Array.isArray(list)) return { error: 'Fabric composition could not be read.' };

  const rows = list
    .filter((r) => r && (String(r.fibre ?? '').trim() || String(r.percent ?? '').trim()))
    .map((r) => ({ fibre: String(r.fibre ?? '').trim(), percent: Number(r.percent) }));
  if (!rows.length) return { composition: undefined };
  if (rows.length > 10) return { error: 'Fabric composition can list up to 10 fibres.' };
  if (rows.some((r) => !r.fibre || r.fibre.length > 40)) {
    return { error: 'Each fibre needs a name (up to 40 characters).' };
  }
  if (rows.some((r) => !Number.isFinite(r.percent) || r.percent < 0.1 || r.percent > 100)) {
    return { error: 'Each fibre needs a share between 0.1 and 100 %.' };
  }
  const total = rows.reduce((s, r) => s + r.percent, 0);
  if (Math.abs(total - 100) > 0.5) {
    return { error: `Fabric composition must add up to 100 % (now ${Math.round(total * 10) / 10} %).` };
  }
  return { composition: rows };
}

/**
 * Остаток в строках сетки: '' или null — не указан (поле убирается), иначе целое ≥ 0.
 * Меняет строки на месте. @returns {string|null} ошибка
 */
export function normalizeStock(rows) {
  for (const row of rows || []) {
    if (row.stock === '' || row.stock === null || row.stock === undefined) {
      delete row.stock;
      continue;
    }
    const n = Number(row.stock);
    if (!Number.isInteger(n) || n < 0) return `Stock for size ${row.size} must be a whole number, 0 or more.`;
    row.stock = n;
  }
  return null;
}

/**
 * Галерея при изменении товара: keep — JSON-список уже сохранённых адресов в нужном порядке
 * (undefined — оставить все), added — адреса новых файлов (в конец).
 * @returns {{ images?: string[], removed?: string[], error?: string }}
 */
export function nextGallery(current, keepRaw, added) {
  let kept = current || [];
  if (keepRaw !== undefined) {
    let keep;
    try { keep = typeof keepRaw === 'string' ? JSON.parse(keepRaw || '[]') : keepRaw; } catch { keep = null; }
    if (!Array.isArray(keep)) return { error: 'The photo list could not be read.' };
    // только свои фото этого товара: чужой адрес подставить нельзя
    kept = keep.map(String).filter((u, i, a) => kept.includes(u) && a.indexOf(u) === i);
  }
  const images = [...kept, ...added];
  if (images.length > MAX_GALLERY) return { error: `Up to ${MAX_GALLERY} extra photos.` };
  return { images, removed: (current || []).filter((u) => !kept.includes(u)) };
}
