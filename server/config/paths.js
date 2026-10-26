// server/config/paths.js
//
// Единое место для папки загрузок. Раньше товары писались в process.cwd()/uploads,
// а раздавались из server/uploads — работало, только если сервер запущен из server/.
//
// UPLOADS_DIR в окружении переносит папку целиком (например, для тестового сервера).

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(SERVER_DIR, 'uploads'));
export const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
export const MODELS_DIR = path.join(UPLOADS_DIR, 'models');
export const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
// выкройки и входы Newton по товарам — не в /uploads: наружу их не раздаём
export const PATTERNS_DIR = path.resolve(process.env.PATTERNS_DIR || path.join(SERVER_DIR, 'data', 'patterns'));

for (const dir of [UPLOADS_DIR, IMAGES_DIR, MODELS_DIR, AVATARS_DIR, PATTERNS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Публичный адрес '/uploads/images/x.png' → путь на диске.
 * Всё, что выходит за пределы UPLOADS_DIR (../, абсолютные пути, чужие URL), → null.
 */
export function uploadsUrlToPath(url) {
  const s = String(url || '');
  if (!s.startsWith('/uploads/')) return null;
  const abs = path.resolve(UPLOADS_DIR, s.slice('/uploads/'.length));
  return abs.startsWith(UPLOADS_DIR + path.sep) ? abs : null;
}
