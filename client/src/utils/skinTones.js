// client/src/utils/skinTones.js
//
// Тон кожи аватара: 10 тонов шкалы Monk Skin Tone (токены --skin-1 … --skin-10
// в styles/tokens.css). В профиле тела хранится ключ, а не цвет: палитру можно
// поправить в одном месте, и сохранённые профили подхватят её сами.
//
// "Monk Skin Tone Scale" by Dr. Ellis Monk, Google LLC, CC BY 4.0 — https://skintone.google

export const SKIN_TONES = Array.from({ length: 10 }, (_, i) => `skin-${i + 1}`);
export const DEFAULT_SKIN_TONE = 'skin-5';

export const isSkinTone = (value) => SKIN_TONES.includes(value);

/** CSS-переменная тона: 'skin-3' → 'var(--skin-3)'. */
export const skinToneVar = (key) => `var(--${isSkinTone(key) ? key : DEFAULT_SKIN_TONE})`;

/** Подпись для экранных читалок и подсказки. */
export function skinToneLabel(key) {
  const n = SKIN_TONES.indexOf(key) + 1;
  const end = n === 1 ? ' (lightest)' : n === SKIN_TONES.length ? ' (deepest)' : '';
  return `Skin tone ${n} of ${SKIN_TONES.length}${end}`;
}

/** Палитра из токенов: { 'skin-1': '#F6EDE4', ... }. Пустая, если CSS не загружен. */
export function readSkinPalette(root = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!root) return {};
  const style = getComputedStyle(root);
  const out = {};
  SKIN_TONES.forEach((key) => {
    const value = style.getPropertyValue(`--${key}`).trim();
    if (value) out[key] = value;
  });
  return out;
}

const HEX = /^#([0-9a-f]{6})$/i;

function rgb(hex) {
  const m = HEX.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Ближайший тон палитры к произвольному цвету (для старых профилей с цветом вместо ключа). */
export function nearestSkinTone(hex, palette) {
  const c = rgb(hex);
  if (!c) return null;
  let best = null;
  let bestDist = Infinity;
  Object.entries(palette).forEach(([key, value]) => {
    const p = rgb(value);
    if (!p) return;
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = key; }
  });
  return best;
}

/**
 * Любое сохранённое значение → ключ тона.
 * Ключ — как есть; старый цвет из прежнего выбора (#rrggbb) — ближайший тон;
 * всё остальное ('neutral', пусто) — тон по умолчанию.
 */
export function resolveSkinTone(value, palette) {
  if (isSkinTone(value)) return value;
  if (HEX.test(String(value || '').trim())) {
    return nearestSkinTone(value, palette || readSkinPalette()) || DEFAULT_SKIN_TONE;
  }
  return DEFAULT_SKIN_TONE;
}
