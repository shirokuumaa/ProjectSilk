// server/controllers/productController.js
import Product from '../models/Product.js';
import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFilePromise = util.promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/controllers -> server -> корень репозитория -> scripts/
const GARMENT_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'process_garment.py');

/** утилита: безопасно привести к числу */
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[^\d.−-]/g, '').replace('−', '-');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
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

export const getProductById = async (req, res) => {
  try {
    const item = await Product.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (e) {
    console.error('getProductById error:', e);
    res.status(500).json({ message: 'Ошибка при получении товара', error: String(e?.message || e) });
  }
};

/** POST /api/products  (multipart или JSON) */
export const addProduct = async (req, res) => {
  try {
    const { title, name, price, category = 'Clothes', garmentType = 'top' } = req.body;

    // Парсим размерную сетку и валидируем
    let sizeChart = [];
    if (req.body.sizeChart) {
      try {
        const parsed = typeof req.body.sizeChart === 'string'
          ? JSON.parse(req.body.sizeChart)
          : req.body.sizeChart;
        if (Array.isArray(parsed)) {
          sizeChart = parsed.filter((s) => {
            // каждая строка должна иметь size и хотя бы один обмер
            return s && s.size && (s.chest || s.waist || s.hips || s.length || s.sleeve);
          });
        }
      } catch (e) {
        console.warn('sizeChart parse failed:', e.message);
      }
    }

    // ── Картинка ───────────────────────────────────────────────
    let imageUrl = null;
    if (req.files?.image?.[0]) {
      imageUrl = `/uploads/images/${req.files.image[0].filename}`;
    } else if (req.file) {
      imageUrl = `/uploads/images/${req.file.filename}`;
    } else if (req.body.image) {
      const img = String(req.body.image);
      if (img.startsWith('blob:')) return res.status(400).json({ message: 'blob: URL нельзя сохранить.' });
      imageUrl = img;
    }

    // ── 3D-модель и интеграция с Blender ───────────────────────
    let model3dUrl = null;

    if (req.files?.model3d?.[0]) {
      const rawFile = req.files.model3d[0];
      const rawFilePath = rawFile.path; 
      
      // Имя и путь для обработанного файла
      const preparedFileName = `prepared_${rawFile.filename}`;
      const preparedFilePath = path.join(rawFile.destination, preparedFileName);

      const blenderPath = process.env.BLENDER_PATH || '/Applications/Blender.app/Contents/MacOS/Blender';

      // По умолчанию — сырая модель; prepared подставляем только если файл реально появился
      model3dUrl = `/uploads/models/${rawFile.filename}`;

      if (!fs.existsSync(GARMENT_SCRIPT)) {
        console.error(`❌ [Blender] Скрипт не найден: ${GARMENT_SCRIPT}. Сохраняем сырую модель.`);
      } else {
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
            model3dUrl = `/uploads/models/${preparedFileName}`;
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
      }
    } else if (req.body.model3d) {
      model3dUrl = String(req.body.model3d);
    }

    // ── Валидация и сохранение ─────────────────────────────────
    if (!title || imageUrl == null || price == null) {
      return res.status(400).json({ message: 'title, price, image — обязательны' });
    }
    const priceNum = toNumber(price);
    if (!Number.isFinite(priceNum)) {
      return res.status(400).json({ message: 'price должен быть числом' });
    }

    const doc = await Product.create({
      title: String(title).trim(),
      name: String(name || title).trim(),
      price: priceNum,
      category: String(category || 'Clothes'),
      garmentType: String(garmentType || 'top'),
      sizeChart,
      image: imageUrl,
      model3d: model3dUrl || undefined,
      rating: 0,
    });

    res.status(201).json(doc);
  } catch (e) {
    console.error('addProduct error:', e);
    res.status(500).json({ message: 'Ошибка при добавлении товара', error: String(e?.message || e) });
  }
};