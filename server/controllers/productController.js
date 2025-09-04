// server/controllers/productController.js
import Product from '../models/Product.js';

/** GET /api/products */
export const getAllProducts = async (_req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при получении товаров', error });
  }
};

/** GET /api/products/:id */
export const getProductById = async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ message: 'Not found' });
    res.json(p);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при получении товара', error });
  }
};

/**
 * POST /api/products
 * Поддерживает:
 *  - multipart/form-data (через multer):
 *      image → req.file (или req.files.image[0])
 *      model3d → req.files.model3d[0] (если используешь upload.fields)
 *  - JSON: { title, price, image, model3d }
 */
export const addProduct = async (req, res) => {
  try {
    const { title, price } = req.body;

    // ---------- КАРТИНКА ----------
    let imageUrl = null;

    // если в роуте стоит upload.single('image')
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }
    // если в роуте стоит upload.fields(...)
    else if (req.files?.image?.[0]) {
      imageUrl = `/uploads/${req.files.image[0].filename}`;
    }
    // JSON-путь/внешний URL
    else if (req.body.image) {
      const img = String(req.body.image);
      if (img.startsWith('blob:')) {
        return res.status(400).json({ message: 'blob: URL нельзя сохранить. Пришли файл.' });
      }
      imageUrl = img;
    }

    // ---------- 3D-МОДЕЛЬ (необяз.) ----------
    let model3dUrl = null;
    if (req.files?.model3d?.[0]) {
      model3dUrl = `/uploads/${req.files.model3d[0].filename}`;
    } else if (req.body.model3d) {
      model3dUrl = String(req.body.model3d);
    }

    // ---------- ВАЛИДАЦИЯ ----------
    if (!title || imageUrl == null || price == null) {
      return res.status(400).json({ message: 'title, price, image — обязательны' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum)) {
      return res.status(400).json({ message: 'price должен быть числом' });
    }

    // ---------- СОХРАНЕНИЕ ----------
    const newProduct = await Product.create({
      title: String(title).trim(),
      price: priceNum,
      image: imageUrl,
      model3d: model3dUrl || undefined,
    });

    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при добавлении товара', error });
  }
};