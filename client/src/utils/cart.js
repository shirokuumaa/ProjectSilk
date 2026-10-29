// client/src/utils/cart.js
//
// Строки корзины. Строка — товар в одном размере: одна вещь в S и в M — две строки.
// Размер в корзину — выбранный покупателем, иначе рекомендованный по его обмерам
// (обмеры из кэша браузера). Нет обмеров или сетки — строка без размера.

import { getCachedBodyProfile, isProfileComplete } from './bodyProfileApi';
import { findBestSize, sizeChartOf } from './fitCalculator';

/** Ключ строки: товар + размер. */
export const cartLineKey = (item) => `${item?.id ?? ''}|${item?.size ?? ''}`;

/** Размер для корзины: выбранный, иначе рекомендованный; null — посчитать нечем. */
export function cartSizeFor(product, chosen = null) {
  if (chosen) return chosen;
  const chart = sizeChartOf(product);
  const profile = getCachedBodyProfile();
  if (!chart.length || !isProfileComplete(profile)) return null;
  return findBestSize(profile, chart).recommended?.size || null;
}

/** Добавить товар или несколько: та же вещь в том же размере — +1 к количеству. */
export function addCartLines(lines, products) {
  const next = [...lines];
  (Array.isArray(products) ? products : [products]).forEach((p) => {
    const line = { ...p, size: p.size || null };
    const key = cartLineKey(line);
    const i = next.findIndex((x) => cartLineKey(x) === key);
    if (i >= 0) next[i] = { ...next[i], quantity: (next[i].quantity || 1) + 1 };
    else next.push({ ...line, quantity: 1 });
  });
  return next;
}

/** Убрать одну штуку из строки; последняя штука убирает строку. */
export function removeCartLine(lines, key) {
  return lines
    .map((x) => (cartLineKey(x) === key ? { ...x, quantity: (x.quantity || 1) - 1 } : x))
    .filter((x) => x.quantity > 0);
}
