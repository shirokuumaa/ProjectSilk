// server/controllers/productController.js
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadsUrlToPath } from '../config/paths.js';
import { validateUploads, uploadedFiles, removeFiles } from '../utils/uploadChecks.js';

const execFilePromise = util.promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/controllers -> server -> корень репозитория -> scripts/
const GARMENT_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'process_garment.py');

/** утилита: безопасно привести к числу */
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[^\d.−-]/g, '').replace('−', '-');
  if (s === '') return NaN; // Number('') === 0 — «abc» не должно стать ценой 0
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Размерная сетка из тела запроса; undefined — поле не передано. */
function parseSizeChart(raw) {
  if (raw === undefined) return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    // каждая строка должна иметь size и хотя бы один обмер
    return parsed.filter((s) => s && s.size && (s.chest || s.waist || s.hips || s.length || s.sleeve));
  } catch (e) {
    console.warn('sizeChart parse failed:', e.message);
    return [];
  }
}

/** Файлы модели на диске: сама модель и её пара raw ↔ prepared_. */
function modelFilePaths(modelUrl) {
  if (!modelUrl) return [];
  const dir = path.posix.dirname(modelUrl);
  const name = path.posix.basename(modelUrl);
  const twin = name.startsWith('prepared_') ? name.slice('prepared_'.length) : `prepared_${name}`;
  return [uploadsUrlToPath(modelUrl), uploadsUrlToPath(`${dir}/${twin}`)].filter(Boolean);
}

function productFilePaths(product) {
  return [uploadsUrlToPath(product.image), ...modelFilePaths(product.model3d)].filter(Boolean);
}

/**
 * Нормализация GLB в Blender.
 * @returns {{ url: string, created: string[] }} — url для model3d и созданные файлы
 */
async function normalizeModel(rawFile) {
  const rawFilePath = rawFile.path;

  // Имя и путь для обработанного файла
  const preparedFileName = `prepared_${rawFile.filename}`;
  const preparedFilePath = path.join(rawFile.destination, preparedFileName);

  const blenderPath = process.env.BLENDER_PATH || '/Applications/Blender.app/Contents/MacOS/Blender';

  // По умолчанию — сырая модель; prepared подставляем только если файл реально появился
  let url = `/uploads/models/${rawFile.filename}`;
  const created = [];

  if (!fs.existsSync(GARMENT_SCRIPT)) {
    console.error(`❌ [Blender] Скрипт не найден: ${GARMENT_SCRIPT}. Сохраняем сырую модель.`);
    return { url, created };
  }

  try {
    console.log(`🔄 [Blender] Запуск нормализации для ${rawFile.filename}...`);

    // headless; --python-exit-code 1 — ошибка скрипта даёт ненулевой код выхода
    await execFilePromise(
      blenderPath,
      ['-b', '--python-exit-code', '1', '-P', GARMENT_SCRIPT, '--', rawFilePath, preparedFilePath],
      { timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    );

    const prepared = fs.existsSync(preparedFilePath) ? fs.statSync(preparedFilePath) : null;
    if (prepared && prepared.size > 0) {
      console.log(`✅ GLB нормализован: ${preparedFileName}`);
      url = `/uploads/models/${preparedFileName}`;
      created.push(preparedFilePath);
    } else {
      console.error(`❌ [Blender] Завершился без ошибки, но файла ${preparedFileName} нет или он пустой. Сохраняем сырую модель.`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`❌ [Blender] Blender не найден по пути ${blenderPath}. Задайте BLENDER_PATH. Сохраняем сырую модель.`);
    } else if (err.killed) {
      console.error('❌ [Blender] Превышен таймаут 180 с. Сохраняем сырую модель.');
    } else {
      console.error(`❌ [Blender] Ошибка нормализации (код ${err.code}): ${err.stderr || err.message}. Сохраняем сырую модель.`);
    }
  }

  return { url, created };
}

function sendValidationError(res, e) {
  return res.status(400).json({
    message: 'Invalid product data.',
    details: Object.values(e.errors || {}).map((x) => x.message),
  });
}

export const getAllProducts = async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('getAllProducts error:', e);
    res.status(500).json({ message: 'Ошибка при получении товаров', error: String(e?.message || e) });
  }
};

/** GET /api/products/mine — товары текущего продавца */
export const getMyProducts = async (req, res) => {
  try {
    const items = await Product.find({ owner: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('getMyProducts error:', e);
    res.status(500).json({ message: 'Could not load your products.' });
  }
};

export const getProductById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
    const item = await Product.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (e) {
    console.error('getProductById error:', e);
    res.status(500).json({ message: 'Ошибка при получении товара', error: String(e?.message || e) });
  }
};

/** POST /api/products  (multipart: image обязательна, model3d — по желанию) */
export const addProduct = async (req, res) => {
  // всё, что записали в этом запросе, — удалить, если товар не сохранится
  const created = uploadedFiles(req).map((f) => f.path);
  const fail = (status, message) => {
    removeFiles(created);
    return res.status(status).json({ message });
  };

  try {
    const bad = await validateUploads(req);
    if (bad) return fail(bad.status, bad.message);

    const imageFile = req.files?.image?.[0];
    if (!imageFile) return fail(400, 'Product image is required.');

    const { name, category = 'Clothes', garmentType = 'top' } = req.body;
    const title = String(req.body.title ?? '').trim();
    if (!title) return fail(400, 'Product title is required.');

    const priceNum = toNumber(req.body.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return fail(400, 'Price must be a positive number.');

    // ── 3D-модель и интеграция с Blender (после проверок — Blender дорогой) ──
    let model3dUrl;
    const modelFile = req.files?.model3d?.[0];
    if (modelFile) {
      const model = await normalizeModel(modelFile);
      model3dUrl = model.url;
      created.push(...model.created);
    }

    const doc = await Product.create({
      title,
      name: String(name || title).trim(),
      price: priceNum,
      category: String(category || 'Clothes'),
      garmentType: String(garmentType || 'top'),
      sizeChart: parseSizeChart(req.body.sizeChart) ?? [],
      image: `/uploads/images/${imageFile.filename}`,
      model3d: model3dUrl,
      rating: 0,
      owner: req.user.id,
    });

    res.status(201).json(doc);
  } catch (e) {
    removeFiles(created);
    if (e.name === 'ValidationError') return sendValidationError(res, e);
    console.error('addProduct error:', e);
    res.status(500).json({ message: 'Could not save the product.' });
  }
};

/**
 * PATCH /api/products/:id  (multipart или JSON)
 * Меняются только перечисленные поля; владелец не меняется никогда.
 * req.product подставляет loadOwnProduct — права уже проверены.
 */
export const updateProduct = async (req, res) => {
  const created = uploadedFiles(req).map((f) => f.path);
  const fail = (status, message) => {
    removeFiles(created);
    return res.status(status).json({ message });
  };

  try {
    const bad = await validateUploads(req);
    if (bad) return fail(bad.status, bad.message);

    const product = req.product;
    const b = req.body || {};
    const replaced = []; // старые файлы — удалить после успешного сохранения

    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) return fail(400, 'Product title cannot be empty.');
      product.title = title;
    }
    if (b.name !== undefined) product.name = String(b.name).trim() || product.title;
    if (b.price !== undefined) {
      const priceNum = toNumber(b.price);
      if (!Number.isFinite(priceNum) || priceNum < 0) return fail(400, 'Price must be a positive number.');
      product.price = priceNum;
    }
    if (b.category !== undefined) product.category = String(b.category);
    if (b.garmentType !== undefined) product.garmentType = String(b.garmentType);
    if (b.sizeChart !== undefined) product.sizeChart = parseSizeChart(b.sizeChart);

    const imageFile = req.files?.image?.[0];
    if (imageFile) {
      replaced.push(uploadsUrlToPath(product.image));
      product.image = `/uploads/images/${imageFile.filename}`;
    }

    const modelFile = req.files?.model3d?.[0];
    if (modelFile) {
      replaced.push(...modelFilePaths(product.model3d));
      const model = await normalizeModel(modelFile);
      created.push(...model.created);
      product.model3d = model.url;
    }

    await product.save();
    removeFiles(replaced);
    res.json(product);
  } catch (e) {
    removeFiles(created);
    if (e.name === 'ValidationError') return sendValidationError(res, e);
    console.error('updateProduct error:', e);
    res.status(500).json({ message: 'Could not update the product.' });
  }
};

/** DELETE /api/products/:id — товар и его файлы (картинка, модель raw и prepared) */
export const deleteProduct = async (req, res) => {
  try {
    const files = productFilePaths(req.product);
    await req.product.deleteOne();
    removeFiles(files);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteProduct error:', e);
    res.status(500).json({ message: 'Could not delete the product.' });
  }
};
