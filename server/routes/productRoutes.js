// server/routes/productRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import mongoose from "mongoose";
import {
  addProduct,
  updateProduct,
  deleteProduct,
  getAllProducts,
  getMyProducts,
  getProductById,
} from "../controllers/productController.js";
import Product from "../models/Product.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { IMAGES_DIR, MODELS_DIR } from "../config/paths.js";
import {
  IMAGE_EXTENSIONS, MODEL_EXTENSIONS, MAX_MODEL_BYTES, uploadedFiles, removeFiles,
} from "../utils/uploadChecks.js";

// ───────────── Multer: куда и как сохранять ─────────────
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "model3d") return cb(null, MODELS_DIR);
    return cb(null, IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const original = file.originalname || "file";
    const ext  = path.extname(original).toLowerCase();
    const base = path.basename(original, path.extname(original))
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 60) || "file";
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}_${base}${ext}`);
  },
});

// publicMessage — наш текст для пользователя; текст исключений наружу не уходит
const uploadError = (message) => Object.assign(new Error(message), { status: 400, publicMessage: message });

// ───────────── Фильтр типов ─────────────
// Здесь — только расширение (оно определяет Content-Type при раздаче /uploads).
// Содержимое проверяется после записи: validateUploads() в контроллере.
const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (file.fieldname === "image") {
    return IMAGE_EXTENSIONS.includes(ext)
      ? cb(null, true)
      : cb(uploadError("Image must be a JPEG, PNG or WebP file."));
  }
  if (file.fieldname === "model3d") {
    return MODEL_EXTENSIONS.includes(ext)
      ? cb(null, true)
      : cb(uploadError("3D model must be a .glb file."));
  }
  return cb(uploadError(`Unexpected file field: ${file.fieldname}`));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_MODEL_BYTES, files: 2 },
}).fields([
  { name: "image",   maxCount: 1 },
  { name: "model3d", maxCount: 1 },
]);

const UPLOAD_MESSAGES = {
  LIMIT_FILE_COUNT: "Too many files (one image and one 3D model at most).",
  LIMIT_UNEXPECTED_FILE: "Unexpected file field.",
  LIMIT_PART_COUNT: "Too many form fields.",
  LIMIT_FIELD_VALUE: "A form field is too long.",
};

/** multer + понятные ошибки вместо 500; при ошибке записанное удаляется. */
function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    removeFiles(uploadedFiles(req).map((f) => f.path));

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "File is too large (maximum 50 MB)." });
      }
      return res.status(400).json({ message: UPLOAD_MESSAGES[err.code] || "Could not upload the file." });
    }
    if (err.publicMessage) return res.status(400).json({ message: err.publicMessage });
    return next(err);
  });
}

/** Товар из :id, если он принадлежит текущему продавцу. Иначе 404 / 403. */
async function loadOwnProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Product not found." });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found." });
    if (String(product.owner) !== req.user.id) {
      return res.status(403).json({ message: "You can only change your own products." });
    }

    req.product = product;
    next();
  } catch (err) {
    next(err);
  }
}

const router = express.Router();
const sellerOnly = [requireAuth, requireRole("seller")];

/**
 * Монтировать так: app.use("/api/products", productRoutes)
 *   GET    /api/products          — каталог, открыт всем
 *   GET    /api/products/mine     — товары текущего продавца
 *   GET    /api/products/:id      — открыт всем
 *   POST   /api/products          — только продавец
 *   PATCH  /api/products/:id      — только владелец товара
 *   DELETE /api/products/:id      — только владелец товара
 *
 * Права проверяются ДО multer: файлы от покупателя или чужого продавца
 * не успевают записаться на диск.
 */
router.get("/", getAllProducts);
router.get("/mine", ...sellerOnly, getMyProducts);
router.get("/:id", getProductById);

router.post("/", ...sellerOnly, handleUpload, addProduct);
router.patch("/:id", ...sellerOnly, loadOwnProduct, handleUpload, updateProduct);
router.delete("/:id", ...sellerOnly, loadOwnProduct, deleteProduct);

export default router;
