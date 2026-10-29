// server/controllers/productController.js
import mongoose from 'mongoose';
import Product, { GARMENT_TYPES } from '../models/Product.js';
import WardrobeItem from '../models/WardrobeItem.js';
import { parseSilhouette, silhouetteFits } from '../utils/silhouettes.js';
import { parseAccessory } from '../utils/accessory.js';
import {
  enqueue, markQueued, needsPatterns, patternInputs, removePatterns,
} from '../services/patternJobs.js';
import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadsUrlToPath } from '../config/paths.js';
import { validateUploads, uploadedFiles, removeFiles } from '../utils/uploadChecks.js';
import {
  nextGallery, normalizeStock, parseComposition, parseText,
} from '../utils/productDetails.js';

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

const GIRTHS = ['chest', 'waist', 'hips'];
const GIRTH_MODES = ['circumference', 'flat'];

/**
 * Размерная сетка из тела запроса; undefined — поле не передано.
 * girthMode 'flat' — продавец ввёл ширину изделия в разложенном виде (половину
 * обхвата): грудь, талию и бёдра умножаем на 2. Длины не трогаем. Хранится
 * всегда полный обхват.
 */
function parseSizeChart(raw, girthMode = 'circumference') {
  if (raw === undefined) return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    // каждая строка должна иметь size и хотя бы один обмер
    const rows = parsed.filter((s) => s && s.size && (s.chest || s.waist || s.hips || s.length || s.sleeve || s.shoulder));
    if (girthMode !== 'flat') return rows;
    return rows.map((r) => {
      const out = { ...r };
      GIRTHS.forEach((k) => {
        const n = Number(r[k]);
        if (r[k] != null && r[k] !== '' && Number.isFinite(n)) out[k] = Math.round(n * 2 * 10) / 10;
      });
      return out;
    });
  } catch (e) {
    console.warn('sizeChart parse failed:', e.message);
    return [];
  }
}

/** Как продавец указал обхваты; null — неизвестное значение. */
function girthModeOf(body) {
  const mode = body?.girthMode ?? 'circumference';
  return GIRTH_MODES.includes(mode) ? mode : null;
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
  return [
    uploadsUrlToPath(product.image), ...(product.images || []).map(uploadsUrlToPath),
    uploadsUrlToPath(product.print?.image), ...modelFilePaths(product.model3d),
  ].filter(Boolean);
}

const galleryUrls = (req) => (req.files?.gallery || []).map((f) => `/uploads/images/${f.filename}`);

/**
 * Описание, состав, уход, страна из формы. undefined у поля — не передано.
 * @returns {{ fields: object, error?: string }}
 */
function detailsOf(body) {
  const fields = {};
  for (const key of ['description', 'care', 'countryOfOrigin']) {
    const t = parseText(key, body[key]);
    if (t.error) return { fields, error: t.error };
    if (!t.skip) fields[key] = t.value;
  }
  const c = parseComposition(body.composition);
  if (c.error) return { fields, error: c.error };
  if (!c.skip) fields.composition = c.composition;
  return { fields };
}

/** Повтор принта по умолчанию, см: 10 см ткани на плитку — клетка, полоска, мелкий цветок. */
export const DEFAULT_PRINT_TILE_CM = 10;
const PRINT_TILE_MESSAGE = 'Print repeat must be between 1 and 200 cm.';

/** Повтор принта из формы: пусто — по умолчанию; не число или вне 1…200 см — null. */
function printTileCmOf(v) {
  if (v == null || v === '') return DEFAULT_PRINT_TILE_CM;
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? n : null;
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

/** lean() не подставляет значения по умолчанию: у старых товаров нет stretch → 'none'. */
const withDefaults = (p) => (p ? { stretch: 'none', ...p } : p);

/** Свои тексты для полей; остальные — по названию поля. */
const FIELD_MESSAGES = {
  stretch: 'Fabric stretch must be none, slight or stretchy.',
  garmentType: 'Please choose the garment type.',
  color: 'Colour must look like #a1b2c3.',
};

/** Цвет из формы: пусто — нет цвета (undefined); проверка формата — схема. */
const colorOf = (v) => (v == null || v === '' ? undefined : String(v).trim());

/** Текст ошибок mongoose («Path `price` is required») наружу не отдаём — только наши сообщения и названия полей. */
function sendValidationError(res, e) {
  const fields = Object.keys(e.errors || {});
  const known = fields.filter((f) => FIELD_MESSAGES[f]).map((f) => FIELD_MESSAGES[f]);
  const other = fields.filter((f) => !FIELD_MESSAGES[f]);
  const parts = [...known, ...(other.length ? [`Please check: ${other.join(', ')}.`] : [])];
  return res.status(400).json({
    message: parts.length ? `Invalid product data. ${parts.join(' ')}` : 'Invalid product data.',
    fields,
  });
}

export const getAllProducts = async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(items.map(withDefaults));
  } catch (e) {
    console.error('getAllProducts error:', e);
    res.status(500).json({ message: 'Could not load products.' });
  }
};

/** GET /api/products/mine — товары текущего продавца */
export const getMyProducts = async (req, res) => {
  try {
    const items = await Product.find({ owner: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(items.map(withDefaults));
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
    res.json(withDefaults(item));
  } catch (e) {
    console.error('getProductById error:', e);
    res.status(500).json({ message: 'Could not load the product.' });
  }
};

/** POST /api/products  (multipart: image обязательна, print (плитка принта) и model3d — по желанию) */
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

    const { name, category = 'Clothes' } = req.body;
    // тип обязателен: от него зависит, куда вещь садится на фигуре
    const garmentType = String(req.body.garmentType ?? '');
    if (!GARMENT_TYPES.includes(garmentType)) return fail(400, 'Please choose the garment type.');
    const sil = parseSilhouette(req.body.silhouette, garmentType);
    if (sil.error) return fail(400, sil.error);
    const acc = parseAccessory(req.body.accessory, garmentType);
    if (acc.error) return fail(400, acc.error);
    const girthMode = girthModeOf(req.body);
    if (!girthMode) return fail(400, 'Measurements must be given as full circumference or flat width.');
    const title = String(req.body.title ?? '').trim();
    if (!title) return fail(400, 'Product title is required.');
    const details = detailsOf(req.body);
    if (details.error) return fail(400, details.error);
    const sizeChart = parseSizeChart(req.body.sizeChart, girthMode) ?? [];
    const stockError = normalizeStock(sizeChart);
    if (stockError) return fail(400, stockError);
    const gallery = nextGallery([], undefined, galleryUrls(req));
    if (gallery.error) return fail(400, gallery.error);

    const priceNum = toNumber(req.body.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return fail(400, 'Price must be a positive number.');

    // принт: плитка с фото и её размер на ткани; без плитки вещь однотонная
    const printFile = req.files?.print?.[0];
    const tileCm = printTileCmOf(req.body.printTileCm);
    if (printFile && tileCm === null) return fail(400, PRINT_TILE_MESSAGE);

    // ── 3D-модель и интеграция с Blender (после проверок — Blender дорогой) ──
    let model3dUrl;
    const modelFile = req.files?.model3d?.[0];
    if (modelFile) {
      const model = await normalizeModel(modelFile);
      model3dUrl = model.url;
      created.push(...model.created);
    }

    const doc = new Product({
      title,
      name: String(name || title).trim(),
      price: priceNum,
      category: String(category || 'Clothes'),
      garmentType,
      silhouette: sil.silhouette || undefined,
      accessory: acc.accessory || undefined,
      color: colorOf(req.body.color),
      print: printFile ? { image: `/uploads/images/${printFile.filename}`, tileCm } : undefined,
      stretch: req.body.stretch || 'none',
      sizeChart,
      legs: req.body.legs || undefined,
      image: `/uploads/images/${imageFile.filename}`,
      images: gallery.images,
      ...details.fields,
      model3d: model3dUrl,
      rating: 0,
      owner: req.user.id,
    });
    // силуэт и сетка — выкройки строятся в фоне (services/patternJobs.js)
    if (needsPatterns(doc)) markQueued(doc);
    await doc.save();
    if (doc.patterns) enqueue(doc._id);

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
    const inputsBefore = patternInputs(product);

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
    if (b.silhouette !== undefined) {
      const sil = parseSilhouette(b.silhouette, product.garmentType);
      if (sil.error) return fail(400, sil.error);
      product.silhouette = sil.silhouette || undefined;
    } else if (product.silhouette && !silhouetteFits(product.garmentType, product.silhouette)) {
      product.silhouette = undefined;   // тип сменили — силуэт другого типа больше не подходит
    }
    if (b.accessory !== undefined || b.garmentType !== undefined) {
      // карточку прислали — разобрать; сменили тип — карточка другого типа больше не подходит
      const acc = parseAccessory(b.accessory !== undefined ? b.accessory : product.accessory?.toObject?.(), product.garmentType);
      if (acc.error) return fail(400, acc.error);
      product.accessory = acc.accessory || undefined;
    }
    if (b.stretch !== undefined) product.stretch = b.stretch || 'none';
    if (b.color !== undefined) product.color = colorOf(b.color);
    const girthMode = girthModeOf(b);
    if (!girthMode) return fail(400, 'Measurements must be given as full circumference or flat width.');
    if (b.sizeChart !== undefined) {
      const rows = parseSizeChart(b.sizeChart, girthMode);
      const stockError = normalizeStock(rows);
      if (stockError) return fail(400, stockError);
      product.sizeChart = rows;
    }
    const details = detailsOf(b);
    if (details.error) return fail(400, details.error);
    Object.entries(details.fields).forEach(([k, v]) => { product[k] = v; });

    // галерея: galleryKeep — какие сохранённые фото оставить и в каком порядке; новые — в конец
    const gallery = nextGallery(product.images, b.galleryKeep, galleryUrls(req));
    if (gallery.error) return fail(400, gallery.error);
    product.images = gallery.images;
    replaced.push(...gallery.removed.map(uploadsUrlToPath));
    if (b.legs !== undefined) product.legs = b.legs || undefined;   // пусто — снять подсказку

    const imageFile = req.files?.image?.[0];
    if (imageFile) {
      replaced.push(uploadsUrlToPath(product.image));
      product.image = `/uploads/images/${imageFile.filename}`;
    }

    // принт: новая плитка — заменить; printTileCm '' без плитки — снять (вещь однотонная); число — новый повтор
    const printFile = req.files?.print?.[0];
    if (printFile || b.printTileCm !== undefined) {
      if (!printFile && b.printTileCm === '') {
        replaced.push(uploadsUrlToPath(product.print?.image));
        product.print = undefined;
      } else {
        const tileCm = printTileCmOf(b.printTileCm ?? product.print?.tileCm);
        if (tileCm === null) return fail(400, PRINT_TILE_MESSAGE);
        if (!printFile && !product.print) return fail(400, 'Add a print image first.');
        if (printFile) replaced.push(uploadsUrlToPath(product.print?.image));
        product.print = { image: printFile ? `/uploads/images/${printFile.filename}` : product.print.image, tileCm };
      }
    }

    const modelFile = req.files?.model3d?.[0];
    if (modelFile) {
      replaced.push(...modelFilePaths(product.model3d));
      const model = await normalizeModel(modelFile);
      created.push(...model.created);
      product.model3d = model.url;
    }

    // выкройки: входы изменились (или прошлая сборка не удалась) — собрать заново; не нужны — убрать
    let queued = false;
    if (!needsPatterns(product)) {
      product.patterns = undefined;
    } else if (patternInputs(product) !== inputsBefore || product.patterns?.status !== 'patterns_ready') {
      markQueued(product);
      queued = true;
    }

    await product.save();
    removeFiles(replaced);
    if (queued) enqueue(product._id);
    else if (!product.patterns) removePatterns(product._id);
    res.json(product);
  } catch (e) {
    removeFiles(created);
    if (e.name === 'ValidationError') return sendValidationError(res, e);
    console.error('updateProduct error:', e);
    res.status(500).json({ message: 'Could not update the product.' });
  }
};

/** DELETE /api/products/:id — товар и его файлы (картинка, плитка принта, модель raw и prepared) */
export const deleteProduct = async (req, res) => {
  try {
    const files = productFilePaths(req.product);
    await req.product.deleteOne();
    // удалённого товара больше нет ни в одном гардеробе
    await WardrobeItem.deleteMany({ productId: String(req.product._id) });
    removeFiles(files);
    removePatterns(req.product._id);
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteProduct error:', e);
    res.status(500).json({ message: 'Could not delete the product.' });
  }
};
