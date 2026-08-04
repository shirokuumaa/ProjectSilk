// server/controllers/productController.js
import Product from '../models/Product.js';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

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
    const { title, name, price, category = 'Clothes' } = req.body;

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
      const scriptPath = path.join(process.cwd(), 'scripts/process_garment.py');

      try {
        console.log(`🔄 [Blender] Запуск нормализации для ${rawFile.filename}...`);
        
        // Запускаем Blender в фоновом режиме (headless)
        await execPromise(`"${blenderPath}" -b -P "${scriptPath}" -- "${rawFilePath}" "${preparedFilePath}"`);
        
        console.log(`✅ GLB нормализован: ${preparedFileName}`);
        // Если всё успешно, сохраняем в базу путь к ОБРАБОТАННОЙ модели
        model3dUrl = `/uploads/models/${preparedFileName}`;
      } catch (err) {
        console.error('❌ [Blender] Ошибка нормализации:', err);
        // Фолбэк: если Blender упал, сохраняем хотя бы сырую модель
        model3dUrl = `/uploads/models/${rawFile.filename}`;
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