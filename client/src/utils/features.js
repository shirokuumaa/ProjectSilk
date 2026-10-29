// client/src/utils/features.js
//
// Недоделанное спрятано от покупателя (docs/PRODUCT_REVIEW.md, задача 2). Код оставлен;
// включается переменной окружения при запуске клиента, как примерка по фото (utils/photoTryOn.js):
//   REACT_APP_ASSISTANT=on      — ассистент (Lunbee): работает через временный туннель, своя корзина
//   REACT_APP_IMAGE_SEARCH=on   — «поиск по картинке»: сейчас ищет по имени файла
//   REACT_APP_CATEGORY_MENU=on  — меню «Categories»: заглушка с «Bath / Storage / Lighting»
//   REACT_APP_AR_DEV=on         — панель разработчика в AR; ещё она открывается по /tryon/ar?debug

const on = (name) => process.env[name] === 'on';

export const assistantEnabled = () => on('REACT_APP_ASSISTANT');
export const imageSearchEnabled = () => on('REACT_APP_IMAGE_SEARCH');
export const categoryMenuEnabled = () => on('REACT_APP_CATEGORY_MENU');

export function arDevToolsEnabled(search = window.location.search) {
  return on('REACT_APP_AR_DEV') || new URLSearchParams(search).has('debug');
}
