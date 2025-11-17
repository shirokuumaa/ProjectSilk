// server/routes/productRoutes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  addProduct,
  getAllProducts,
  getProductById,
} from "../controllers/productController.js";

// ── каталоги для загрузок ─────────────────────────────────────────────
const ROOT = process.cwd();
const DIR_UPLOADS = path.join(ROOT, "uploads");
const DIR_IMAGES  = path.join(DIR_UPLOADS, "images");
const DIR_MODELS  = path.join(DIR_UPLOADS, "models");

for (const p of [DIR_UPLOADS, DIR_IMAGES, DIR_MODELS]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ── Multer: хранение ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "model3d") return cb(null, DIR_MODELS);
    return cb(null, DIR_IMAGES); // "image" по умолчанию
  },
  filename: (_req, file, cb) => {
    const original = file.originalname || "file";
    const dot = original.lastIndexOf(".");
    const ext  = dot >= 0 ? original.slice(dot).toLowerCase() : "";
    const base = original.slice(0, dot >= 0 ? dot : undefined).replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}_${base}${ext}`);
  },
});

// ── фильтр типов ─────────────────────────────────────────────────────
const fileFilter = (_req, file, cb) => {
  if (file.fieldname === "image") {
    return file.mimetype?.startsWith("image/")
      ? cb(null, true)
      : cb(new Error("image: only image/* allowed"));
  }
  if (file.fieldname === "model3d") {
    const ok = new Set([
      "model/gltf-binary", "model/gltf+json",
      "application/octet-stream", "application/octetstream",
      "text/plain", "application/x-tgif",
    ]);
    if (ok.has(file.mimetype)) return cb(null, true);
    if (/\.(glb|gltf|obj|fbx|usdz?)$/i.test(file.originalname || "")) return cb(null, true);
    return cb(new Error("model3d: unsupported file type"));
  }
  return cb(new Error("Unknown field"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
});

const router = express.Router();

/**
 * Монтировать так: app.use("/api/products", productRoutes)
 * ⇒ POST /api/products
 *    GET /api/products
 *    GET /api/products/:id
 */
router.post(
  "/",
  upload.fields([
    { name: "image",   maxCount: 1 },
    { name: "model3d", maxCount: 1 },
  ]),
  addProduct
);

router.get("/", getAllProducts);
router.get("/:id", getProductById);

// ── JSON-обработчик ошибок multer (чтобы не падать HTML-страницей) ──
router.use((err, _req, res, _next) => {
  if (!err) return res.status(500).json({ message: "Unknown error" });
  console.error("productRoutes error:", err);
  const code = err.code || undefined;
  const status = 400;
  res.status(status).json({
    message: err.message || "Upload error",
    code,
  });
});

export default router;