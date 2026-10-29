// server/test/helpers.js
//
// Общая обвязка автотестов: отдельный экземпляр сервера на тестовой базе,
// временная папка загрузок, поддельный GPU-сервер.
//
// Рабочую базу (projectsilk) и server/uploads тесты не трогают НИКОГДА:
// адрес базы и папка заданы здесь константами, а не берутся из .env,
// и перед любым действием проверяются (assertSafeTarget).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_PORT = 5055;
export const TEST_DB = 'projectsilk_authtest';
export const TEST_MONGO_URI = `mongodb://localhost:27017/${TEST_DB}`;
export const BASE = `http://localhost:${TEST_PORT}`;

/** Тестовым процессам — свой секрет; .env с рабочим секретом не нужен. */
export const TEST_JWT_SECRET = crypto.randomBytes(48).toString('base64url');

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
export const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(64)]);
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

function assertSafeTarget({ dbName, uploadsDir }) {
  if (dbName !== TEST_DB) {
    throw new Error(`Тесты работают только с базой ${TEST_DB}, получено: ${dbName}`);
  }
  const tmp = fs.realpathSync(os.tmpdir());
  if (uploadsDir && !fs.realpathSync(uploadsDir).startsWith(tmp + path.sep)) {
    throw new Error(`Папка загрузок тестов должна быть во временной директории, получено: ${uploadsDir}`);
  }
}

/** Удалить тестовую базу целиком (только её — имя проверяется). */
export async function dropTestDb() {
  const conn = await mongoose.createConnection(TEST_MONGO_URI, { serverSelectionTimeoutMS: 4000 }).asPromise();
  try {
    assertSafeTarget({ dbName: conn.name });
    await conn.dropDatabase();
  } finally {
    await conn.close();
  }
}

/** Прямой доступ к тестовой базе — для проверок «что лежит внутри». */
export async function withTestDb(fn) {
  const conn = await mongoose.createConnection(TEST_MONGO_URI, { serverSelectionTimeoutMS: 4000 }).asPromise();
  try {
    assertSafeTarget({ dbName: conn.name });
    return await fn(conn.db);
  } finally {
    await conn.close();
  }
}

/** Поддельный GPU: отвечает JSON и запоминает заголовки каждого запроса. */
export async function startFakeGpu() {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, from: 'fake-gpu', url: req.url }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Запустить index.js как отдельный процесс.
 * База и папка загрузок по умолчанию — тестовые, и это проверяется:
 * даже сервер, который должен упасть при старте, не увидит рабочих данных.
 * @returns {{ child, output: () => string, exited: Promise<number> }}
 */
export function spawnServer(env = {}) {
  const finalEnv = {
    ...process.env,
    MONGODB_URI: TEST_MONGO_URI,
    UPLOADS_DIR: env.UPLOADS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'projectsilk-test-uploads-')),
    ...env,
  };
  assertSafeTarget({
    dbName: new URL(finalEnv.MONGODB_URI).pathname.slice(1),
    uploadsDir: finalEnv.UPLOADS_DIR,
  });

  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: finalEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!env.UPLOADS_DIR) {
    child.on('exit', () => fs.rmSync(finalEnv.UPLOADS_DIR, { recursive: true, force: true }));
  }
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output: () => out, exited };
}

/**
 * Тестовый сервер: чистая тестовая база, своя временная папка загрузок.
 * Ждёт /healthz; если процесс упал раньше — ошибка с его выводом.
 */
export async function startTestServer({ gpuUrl, env = {} } = {}) {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectsilk-test-uploads-'));
  const patternsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectsilk-test-patterns-'));
  assertSafeTarget({ dbName: TEST_DB, uploadsDir });
  await dropTestDb();

  const proc = spawnServer({
    PORT: String(TEST_PORT),
    MONGODB_URI: TEST_MONGO_URI,
    UPLOADS_DIR: uploadsDir,
    JWT_SECRET: TEST_JWT_SECRET,
    BLENDER_PATH: '/nonexistent/blender', // Blender в тестах не запускаем
    PATTERNS_DIR: patternsDir,
    PATTERN_PYTHON: '/nonexistent/python', // настоящие выкройки в тестах не строим (patterns.test.js — подделка)
    AI_MODE: gpuUrl ? 'proxy' : 'off',
    GPU_URL: gpuUrl || '',
    AI_HEAVY_LIMIT_PER_HOUR: '3',
    AI_LIGHT_LIMIT_PER_HOUR: '1000',
    CORS_ORIGINS: 'http://localhost:3011',
    ...env,
  });

  let exitCode = null;
  proc.exited.then((code) => { exitCode = code; });

  for (let i = 0; i < 100; i++) {
    if (exitCode !== null) {
      throw new Error(`Тестовый сервер завершился с кодом ${exitCode}:\n${proc.output()}`);
    }
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) break;
    } catch { /* ещё не слушает */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(`Тестовый сервер не ответил за 10 с:\n${proc.output()}`);
  }

  return {
    uploadsDir,
    patternsDir,
    countFiles: () => ['images', 'models']
      .map((d) => fs.readdirSync(path.join(uploadsDir, d)).length)
      .reduce((a, b) => a + b, 0),
    diskPath: (url) => path.join(uploadsDir, url.slice('/uploads/'.length)),
    async stop() {
      if (exitCode === null) {
        proc.child.kill();
        await proc.exited;
      }
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      fs.rmSync(patternsDir, { recursive: true, force: true });
      await dropTestDb();
    },
  };
}

/** Запрос к тестовому серверу. body — JSON, либо files/fields — multipart. */
export async function api(method, urlPath, { token, body, files, fields, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;

  let payload;
  if (files || fields) {
    payload = new FormData();
    for (const [k, v] of Object.entries(fields || {})) payload.append(k, v);
    // одно поле — [имя, буфер]; несколько файлов в поле — [[имя, буфер], …]
    for (const [k, v] of Object.entries(files || {})) {
      for (const [name, buf] of (Array.isArray(v[0]) ? v : [v])) payload.append(k, new Blob([buf]), name);
    }
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }

  const r = await fetch(BASE + urlPath, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}

export const register = (username, extra = {}) =>
  api('POST', '/api/auth/register', { body: { username, password: 'test-pass-123', ...extra } });

/** Токен из Set-Cookie ответа на вход или регистрацию (в теле его нет). */
export function tokenFromCookie(r) {
  const m = /(?:^|[;,]\s*)ps_token=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/** Зарегистрировать и вернуть { token, user }; токен — из cookie, тесты шлют его как Bearer. */
export async function newUser(username, extra = {}) {
  const r = await register(username, extra);
  if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${r.text}`);
  return { ...r.json, token: tokenFromCookie(r) };
}

/** JWT, подписанный вручную (для истёкших и поддельных токенов). */
export function forgeToken(payload, secret = TEST_JWT_SECRET) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
