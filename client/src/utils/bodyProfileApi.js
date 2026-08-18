// client/src/utils/bodyProfileApi.js
//
// Работа с профилем тела покупателя: сохранение в БД и чтение.
// Профиль — это обмеры, из которых строится аватар и считается подбор размера.

const API = process.env.REACT_APP_API || 'http://localhost:5050';

/** Текущий пользователь из localStorage (как в остальном проекте) */
export function getCurrentUser() {
  return (
    localStorage.getItem('loggedInUser') ||
    localStorage.getItem('user') ||
    null
  );
}

/**
 * Привести данные формы AvatarCreate к формату BodyProfile.
 * Пустые строки отбрасываются, а не превращаются в 0.
 */
export function toBodyProfile(m, user) {
  const num = (v) => {
    if (v === '' || v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const profile = {
    user,
    heightCm: num(m.heightCm),
    chest: num(m.chest),
    waist: num(m.waist),
    hips: num(m.hips),
    shoulderWidth: num(m.shoulders),
    inseam: num(m.inseam),
    weightKg: num(m.weightKg),
    armLength: num(m.armLength),
    skinTone: m.skinTone,
    hairStyle: m.hair,
  };

  // убираем undefined, чтобы не затирать существующие значения в БД
  Object.keys(profile).forEach((k) => {
    if (profile[k] === undefined) delete profile[k];
  });

  return profile;
}

/**
 * Сохранить профиль тела.
 * @returns {Promise<object|null>} сохранённый профиль или null при ошибке
 */
export async function saveBodyProfile(m) {
  const user = getCurrentUser();
  if (!user) {
    console.warn('bodyProfile: пользователь не залогинен, сохраняем только локально');
    return null;
  }

  const payload = toBodyProfile(m, user);

  // минимальный набор для расчёта посадки
  const required = ['heightCm', 'chest', 'waist', 'hips'];
  const missing = required.filter((k) => payload[k] == null);
  if (missing.length) {
    return { incomplete: true, missing };
  }

  try {
    const r = await fetch(`${API}/api/body-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${r.status}`);
    }

    const saved = await r.json();

    // дублируем локально — чтобы карточки товаров работали без запроса к серверу
    try {
      localStorage.setItem('bodyProfile', JSON.stringify(saved));
    } catch { /* quota */ }

    return saved;
  } catch (e) {
    console.error('saveBodyProfile error:', e);
    return null;
  }
}

/**
 * Загрузить профиль тела. Сначала пробует сервер, при неудаче — localStorage.
 */
export async function loadBodyProfile() {
  const user = getCurrentUser();

  if (user) {
    try {
      const r = await fetch(`${API}/api/body-profile/${encodeURIComponent(user)}`);
      if (r.ok) {
        const profile = await r.json();
        if (profile) {
          try {
            localStorage.setItem('bodyProfile', JSON.stringify(profile));
          } catch { /* quota */ }
          return profile;
        }
      }
    } catch (e) {
      console.warn('loadBodyProfile: сервер недоступен, читаем локально');
    }
  }

  try {
    const raw = localStorage.getItem('bodyProfile');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Синхронная версия для мест, где нельзя ждать (карточка товара при рендере).
 * Читает только localStorage.
 */
export function getCachedBodyProfile() {
  try {
    const raw = localStorage.getItem('bodyProfile');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Заполнен ли профиль настолько, чтобы считать посадку */
export function isProfileComplete(profile) {
  if (!profile) return false;
  return ['heightCm', 'chest', 'waist', 'hips'].every(
    (k) => profile[k] != null && profile[k] > 0
  );
}
