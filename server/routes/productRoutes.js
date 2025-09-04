// server/routes/productRoutes.js
import express from 'express';
import multer from 'multer';
import { addProduct, getAllProducts, getProductById } from '../controllers/productController.js';

// аккуратнее с именами и расширениями
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => {
    const ext = file.originalname.includes('.') ? file.originalname.split('.').pop() : '';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext ? '.' + ext : ''}`);
  },
});
const upload = multer({ storage });

const router = express.Router();

// одно изображение и опционально один файл 3D-модели
router.post(
  '/products',
  upload.fields([
    { name: 'image',   maxCount: 1 },
    { name: 'model3d', maxCount: 1 }, // можно не отправлять
  ]),
  addProduct
);

router.get('/products', getAllProducts);
router.get('/products/:id', getProductById);

export default router;