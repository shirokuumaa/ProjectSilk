// client/src/utils/avatarMode.js
//
// Какое тело показывать. По умолчанию — болванка MPFB (base_avatar.glb) в фигуре
// покупателя. Процедурное BodyAvatar — запасное тело: фигура вне калиброванного
// диапазона болванки или файл не загрузился (решает utils/avatarBody.js).
//
// Для сравнения и проверки:
//   ?avatar=standard — всегда процедурное тело (запоминается в этом браузере);
//   ?avatar=base     — вернуть болванку;
//   ?avatarDebug=1   — плашка в сцене: какое тело показано и почему
//                      (только в режиме разработки: покупатель её не увидит и по ссылке).
//
// Ключ новый: выбор, сохранённый при проверке болванки (silk.avatarMode),
// больше ни на что не влияет.

import { useState } from 'react';

const KEY = 'silk.avatarBody';

export function readAvatarMode() {
  try {
    const param = new URLSearchParams(window.location.search).get('avatar');
    if (param === 'base' || param === 'standard') localStorage.setItem(KEY, param);
    return localStorage.getItem(KEY) === 'standard' ? 'standard' : 'base';
  } catch {
    return 'base';
  }
}

export function useAvatarMode() {
  const [mode] = useState(readAvatarMode);
  return mode;
}

/**
 * Плашка «какое тело и почему» («Base avatar · 166 cm», «out of calibrated range») —
 * только в режиме разработки и по ?avatarDebug=1. В сборке для покупателей её нет:
 * ярлыки фигуры и диапазонов покупатель не видит ни на одной странице.
 */
export function avatarDebugEnabled() {
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    return new URLSearchParams(window.location.search).get('avatarDebug') === '1';
  } catch {
    return false;
  }
}
