// client/src/utils/outfit.js
//
// Что надето на аватар витрины. Хранится в том же формате и под тем же ключом, что у полной
// примерки (pages/tryon/TryOnAvatar.jsx: { top, bottom, dress, outerwear, shoes, accessory } →
// id товара), поэтому «Open fitting room» открывает её с тем же образом. Ключ стирается при
// выходе из аккаунта (utils/auth.js).

import { findBestSize, sizeChartOf } from './fitCalculator';
import { garmentTypeOf } from './garmentTemplates';
import { isProfileComplete } from './bodyProfileApi';

export const OUTFIT_KEY = 'avatarOutfitDraft';
export const OUTFIT_SLOTS = ['dress', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'];

/** Фигура гостя без обмеров: средняя фигура калибровки болванки (на ней считались демо-ткани). */
export const STANDARD_FIGURE = { heightCm: 166, chest: 88, waist: 70, hips: 96 };

/** Фигура для примерки: обмеры покупателя или стандартная. */
export const figureOf = (profile) => (isProfileComplete(profile) ? profile : STANDARD_FIGURE);

export function readOutfit() {
  try {
    const j = JSON.parse(localStorage.getItem(OUTFIT_KEY) || '{}');
    return Object.fromEntries(OUTFIT_SLOTS.map((k) => [k, j[k] ?? null]));
  } catch {
    return Object.fromEntries(OUTFIT_SLOTS.map((k) => [k, null]));
  }
}

export function saveOutfit(slots) {
  try { localStorage.setItem(OUTFIT_KEY, JSON.stringify(slots)); } catch { /* приватный режим — не страшно */ }
}

/** Надеть вещь в слот её типа: платье снимает верх и низ, верх или низ — платье. */
export function wearInSlots(slots, type, id) {
  const next = { ...slots, [type]: id };
  if (type === 'dress') { next.top = null; next.bottom = null; }
  if (type === 'top' || type === 'bottom') next.dress = null;
  return next;
}

/** Слой на фигуре: верхняя одежда поверх верха, верх поверх низа и платья. */
export const layerOf = (type) => (type === 'outerwear' ? 3 : type === 'top' ? 2 : 1);

/**
 * Рекомендованный размер вещи для фигуры: { row, fit, message } — строка сетки, разбор
 * по зонам и вердикт словами; без сетки — null.
 */
export function recommendedFor(product, figure) {
  const chart = sizeChartOf(product);
  if (!chart.length) return null;
  const result = findBestSize(figure, chart);
  const fit = result.recommended;
  return fit ? { row: chart.find((r) => r.size === fit.size) || null, fit, message: result.message } : null;
}

export const typeOf = (product) => garmentTypeOf(product);
