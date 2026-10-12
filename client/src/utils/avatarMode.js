// client/src/utils/avatarMode.js
//
// Какое тело показывать: процедурное BodyAvatar (по умолчанию) или болванку
// base_avatar.glb. Пока болванка на проверке, включается только вручную:
//   любая страница с ?avatar=base     — включить (запоминается в этом браузере);
//   любая страница с ?avatar=standard — вернуть процедурное тело.

import { useState } from 'react';

const KEY = 'silk.avatarMode';

export function readAvatarMode() {
  try {
    const param = new URLSearchParams(window.location.search).get('avatar');
    if (param === 'base' || param === 'standard') localStorage.setItem(KEY, param);
    return localStorage.getItem(KEY) === 'base' ? 'base' : 'standard';
  } catch {
    return 'standard';
  }
}

export function useAvatarMode() {
  const [mode] = useState(readAvatarMode);
  return mode;
}
