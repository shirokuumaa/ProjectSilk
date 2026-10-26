// client/src/utils/photoTryOn.js
//
// Примерка по фото выключена (docs/TRYON_REVIEW.md, 1.3): своего сервиса нет, а прежний
// адрес был временным туннелем на чужом хосте — туда ушли бы фото покупателя без согласия.
// Код страниц оставлен. Включение — REACT_APP_PHOTO_TRYON=on; тогда фото уходят только
// на наш сервер (/api/ai/tryon), и больше никуда.

import axios from 'axios';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';

export const photoTryOnEnabled = () => process.env.REACT_APP_PHOTO_TRYON === 'on';

/** Адрес примерки по фото; null — выключена, фото никуда не отправляются. */
export function photoTryOnUrl() {
  return photoTryOnEnabled() ? `${API_BASE}/api/ai/tryon` : null;
}

/** Отправить фото на примерку; результат — картинка (Blob). Выключена — ошибка без запроса. */
export async function sendPhotoTryOn(formData) {
  const url = photoTryOnUrl();
  if (!url) throw new Error('Photo try-on is turned off.');
  const res = await axios.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
    withCredentials: true,
  });
  return res.data;
}
