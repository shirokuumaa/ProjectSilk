// server/services/patternJobs.js
//
// Конвейер одежды, этап 1 (docs/TRYON_REVIEW.md, раздел 3): после сохранения товара с силуэтом
// и сеткой сервер в фоне строит выкройку каждого размера и входы Newton («коробки»).
// Работу делает Python-код исследования — scripts/garments/patterns_job.py, отдельным процессом.
//
// Статус у товара — product.patterns.status:
//   queued         — ждёт или строится;
//   patterns_ready — выкройки готовы (хотя бы для одного размера; по размерам — sizes);
//   failed         — не вышло; message — причина для продавца.
// Очередь — в памяти, по одному товару; после перезапуска сервера «queued» ставятся заново.
// jobId защищает от устаревшего результата: товар изменили, пока шла сборка, — запись
// старой сборки не применится, а товар соберётся ещё раз.
//
// Окружение (по умолчанию — окружения исследования на этом Mac):
//   PATTERN_PYTHON      python с GarmentCode, MPFB-болванкой и т. д. (research/patterns/.envs/mac)
//   PATTERN_SCRIPT      сам скрипт (в тестах — подделка)
//   PATTERN_TIMEOUT_MS  предел на товар, по умолчанию час

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Product from '../models/Product.js';
import { PATTERNS_DIR } from '../config/paths.js';
import { silhouetteFits } from '../utils/silhouettes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = () => process.env.PATTERN_PYTHON || path.join(ROOT, 'research/patterns/.envs/mac/bin/python');
const script = () => process.env.PATTERN_SCRIPT || path.join(ROOT, 'scripts/garments/patterns_job.py');
const timeoutMs = () => Number(process.env.PATTERN_TIMEOUT_MS) || 60 * 60 * 1000;

export const PATTERN_STATUSES = ['queued', 'patterns_ready', 'failed'];
const MESSAGES = {
  notInstalled: 'Pattern tools are not installed on this server.',
  timeout: 'Drafting the patterns took too long.',
  crashed: 'Could not draft the patterns.',
  noSize: 'Could not draft a pattern for any size.',
};

export const patternsDirOf = (id) => path.join(PATTERNS_DIR, String(id));

/** Нужны ли товару выкройки: силуэт своего типа и сетка хотя бы с одним размером. */
export function needsPatterns(product) {
  return silhouetteFits(product.garmentType, product.silhouette) && (product.sizeChart?.length || 0) > 0;
}

/** Всё, от чего зависят выкройки: изменилось — собрать заново. */
export function patternInputs(product) {
  const plain = (v) => (v?.toObject ? v.toObject() : v);
  return JSON.stringify({
    type: product.garmentType ?? null,
    silhouette: plain(product.silhouette) ?? null,
    chart: (product.sizeChart || []).map(plain),
    stretch: product.stretch ?? 'none',
  });
}

/** Отметить товар «queued» до сохранения; в очередь — enqueue после сохранения. */
export function markQueued(product) {
  product.patterns = { status: 'queued', jobId: crypto.randomUUID(), sizes: [], updatedAt: new Date() };
}

export function removePatterns(id) {
  fs.rmSync(patternsDirOf(id), { recursive: true, force: true });
}

// ── очередь ──

const queue = [];
let running = false;

export function enqueue(id) {
  const key = String(id);
  if (!queue.includes(key)) queue.push(key);
  setImmediate(next);
}

async function next() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  try {
    await runJob(id);
  } catch (e) {
    console.error('[patterns] job error:', e);
  } finally {
    running = false;
    setImmediate(next);
  }
}

/** После перезапуска: товары, которые остались «queued». */
export async function resumePatternJobs() {
  const ids = await Product.find({ 'patterns.status': 'queued' }).distinct('_id');
  ids.forEach(enqueue);
  if (ids.length) console.log(`[patterns] resumed ${ids.length} queued product(s)`);
}

function runProcess(cmd, args) {
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs());
    child.stdout.on('data', (d) => process.stdout.write(`[patterns] ${d}`));
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ error, stderr }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, timedOut, stderr }); });
  });
}

function readResult(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch { return null; }
}

/** Итог процесса → поле patterns товара (без jobId и времени). */
export function outcome(run, result) {
  if (run.error) return { status: 'failed', message: run.error.code === 'ENOENT' ? MESSAGES.notInstalled : MESSAGES.crashed };
  if (run.timedOut) return { status: 'failed', message: MESSAGES.timeout };
  if (run.code !== 0 || !result) return { status: 'failed', message: MESSAGES.crashed };
  if (result.error) return { status: 'failed', message: String(result.error) };
  const sizes = [
    ...(result.sizes || []).map((s) => ({ size: String(s.size), ok: true, within1cm: !!s.within_1cm })),
    ...(result.failed || []).map((s) => ({ size: String(s.size), ok: false, error: String(s.error || '') })),
  ];
  if (!result.sizes?.length) {
    return { status: 'failed', message: result.failed?.[0]?.error || MESSAGES.noSize, sizes };
  }
  return { status: 'patterns_ready', sizes };
}

async function runJob(id) {
  const product = await Product.findById(id).lean();
  if (product?.patterns?.status !== 'queued') return;
  const { jobId } = product.patterns;

  const dir = patternsDirOf(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const jobPath = path.join(dir, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify({
    product: String(id),
    title: product.title,
    garmentType: product.garmentType,
    stretch: product.stretch || 'none',
    silhouette: product.silhouette,
    sizeChart: product.sizeChart || [],
  }, null, 1));

  console.log(`[patterns] ${id}: started`);
  const run = await runProcess(python(), [script(), '--job', jobPath, '--out', dir]);
  if (run.stderr && (run.code !== 0 || run.error)) console.error(`[patterns] ${id}:\n${run.stderr}`);
  const patterns = { ...outcome(run, readResult(dir)), jobId, updatedAt: new Date() };
  console.log(`[patterns] ${id}: ${patterns.status}${patterns.message ? ` — ${patterns.message}` : ''}`);

  // товар изменили или удалили, пока шла сборка, — этот результат уже не нужен
  await Product.updateOne({ _id: id, 'patterns.jobId': jobId }, { $set: { patterns } });
}
