// server/controllers/productController.js
import Product from '../models/Product.js';

/** утилита: безопасно привести к числу */
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  // убираем пробелы, запятые и прочее (на случай "1 000" или "1,000")
  const s = String(v).replace(/[^\d.−-]/g, '').replace('−', '-');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** GET /api/products */
export const getAllProducts = async (_req, res) => {
  try {
    const items = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    console.error('getAllProducts error:', e);
    res
      .status(500)
      .json({
        message: 'Ошибка при получении товаров',
        error: String(e?.message || e),
      });
  }
};

/** GET /api/products/:id */
export const getProductById = async (req, res) => {
  try {
    const item = await Product.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (e) {
    console.error('getProductById error:', e);
    res
      .status(500)
      .json({
        message: 'Ошибка при получении товара',
        error: String(e?.message || e),
      });
  }
};

/** POST /api/products  (multipart или JSON) */
export const addProduct = async (req, res) => {
  try {
    const {
      title,
      name,
      price,
      category = 'Clothes',
    } = req.body;

    // ── Картинка ───────────────────────────────────────────────
    let imageUrl = null;

    // если в роутере upload.fields(...)
    if (req.files?.image?.[0]) {
      imageUrl = `/uploads/images/${req.files.image[0].filename}`; // ← /images/
    }
    // если вдруг используется upload.single('image')
    else if (req.file) {
      imageUrl = `/uploads/images/${req.file.filename}`;
    }
    // JSON с внешним URL
    else if (req.body.image) {
      const img = String(req.body.image);
      if (img.startsWith('blob:')) {
        return res.status(400).json({ message: 'blob: URL нельзя сохранить. Пришлите файл.' });
      }
      imageUrl = img;
    }

    // ── 3D-модель (опционально) ───────────────────────────────
    let model3dUrl = null;
    if (req.files?.model3d?.[0]) {
      model3dUrl = `/uploads/models/${req.files.model3d[0].filename}`; // ← /models/
    } else if (req.body.model3d) {
      model3dUrl = String(req.body.model3d);
    }

    // ── Валидация ──────────────────────────────────────────────
    if (!title || imageUrl == null || price == null) {
      return res.status(400).json({ message: 'title, price, image — обязательны' });
    }
    const priceNum = toNumber(price);
    if (!Number.isFinite(priceNum)) {
      return res.status(400).json({ message: 'price должен быть числом' });
    }

    // ── Сохранение ─────────────────────────────────────────────
    const doc = await Product.create({
      title:   String(title).trim(),
      name:    String(name || title).trim(),
      price:   priceNum,
      category: String(category || 'Clothes'),
      image:   imageUrl,
      model3d: model3dUrl || undefined,
      rating:  0,
    });

    res.status(201).json(doc);
  } catch (e) {
    console.error('addProduct error:', e);
    res
      .status(500)
      .json({
        message: 'Ошибка при добавлении товара',
        error: String(e?.message || e),
      });
  }
};