// server/config/cors.js
//
// С каких адресов браузер может ходить к API. CORS_ORIGINS (через запятую) —
// для второго экземпляра, например тестового. Читается при вызове: dotenv
// срабатывает уже после загрузки модулей.

export function allowedOrigins() {
  return process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];
}
