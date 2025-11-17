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

// ───────────── подготовим директории ─────────────
const ROOT = process.cwd();
const DIR_UPLOADS = path.join(ROOT, "uploads");
const DIR_IMAGES  = path.join(DIR_UPLOADS, "images");
const DIR_MODELS  = path.join(DIR_UPLOADS, "models");

for (const p of [DIR_UPLOADS, DIR_IMAGES, DIR_MODELS]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ───────────── Multer: куда и как сохранять ─────────────
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "model3d") return cb(null, DIR_MODELS);
    return cb(null, DIR_IMAGES);
  },
  filename: (_req, file, cb) => {
    const original = file.originalname || "file";
    const dot = original.lastIndexOf(".");
    const ext  = dot >= 0 ? original.slice(dot).toLowerCase() : "";
    const base = original.slice(0, dot >= 0 ? dot : undefined).replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}_${base}${ext}`);
  },
});

// ───────────── Фильтр типов ─────────────
const fileFilter = (_req, file, cb) => {
  if (file.fieldname === "image") {
    // 1) нормальный случай: image/*
    if (file.mimetype && file.mimetype.startsWith("image/")) return cb(null, true);
    // 2) некоторые клиенты (curl, старые браузеры) шлют octet-stream
    if (file.mimetype === "application/octet-stream" || !file.mimetype) return cb(null, true);
    // 3) подстраховка по расширению
    const name = (file.originalname || "").toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)) return cb(null, true);

    return cb(new Error("image: only image/* allowed"));
  }

  if (file.fieldname === "model3d") {
    const okTypes = new Set([
      "model/gltf-binary",   // .glb
      "model/gltf+json",     // .gltf
      "application/octet-stream",
      "application/octetstream",
      "text/plain",          // .obj иногда так приходит
      "application/x-tgif",
    ]);
    if (okTypes.has(file.mimetype)) return cb(null, true);
    const name = (file.originalname || "").toLowerCase();
    if (/\.(glb|gltf|obj|fbx|usdz?)$/i.test(name)) return cb(null, true);

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
 * Пути:
 *   POST /api/products
 *   GET  /api/products
 *   GET  /api/products/:id
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

export default router;