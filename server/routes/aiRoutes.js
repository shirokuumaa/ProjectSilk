// server/routes/aiRoutes.js
import express from "express";
import multer from "multer";
import FormData from "form-data";
import fetch from "node-fetch";
import "dotenv/config";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/* ───────── helpers: очистка и сборка URL ───────── */

// убираем невидимые символы: ZWSP/ZWNJ/ZWJ/BOM/WORD-JOINER
const scrub = (s) => String(s).replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");

// нормализуем базовый адрес GPU (localhost → 127.0.0.1, без хвостовых /, без query/hash)
function normalizeGpuBase(raw) {
  const val = scrub(raw || "http://127.0.0.1:8000").trim();
  const u = new URL(val);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  u.pathname = scrub(u.pathname).replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u.toString(); // напр. "http://127.0.0.1:8000" или "http://ip:port/base"
}
const GPU_BASE = normalizeGpuBase(process.env.GPU_URL);

// аккуратно склеиваем путь (ровно один ведущий /, без двойных //)
const join = (path) => {
  let p = scrub(path || "");
  if (!p.startsWith("/")) p = "/" + p;
  return (GPU_BASE + p).replace(/(?<!:)\/{2,}/g, "/");
};

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

function needFile(req, res) {
  if (!req.file) {
    res.status(400).json({ ok: false, error: 'file required (field "image")' });
    return false;
  }
  return true;
}

async function postMultipart(path, file, timeoutMs = 30000) {
  const fd = new FormData();
  fd.append("image", file.buffer, {
    filename: file.originalname || "image.png",
    contentType: file.mimetype || "image/png",
  });
  const headers = fd.getHeaders(); // важно: сюда попадает boundary

  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const url = join(path);
    return await fetch(url, { method: "POST", body: fd, headers, signal });
  } finally {
    cancel();
  }
}

/* ───────── routes ───────── */

// строгий healthz (без скрытых символов и двойных слэшей)
router.get("/healthz", async (_req, res) => {
  try {
    const { signal, cancel } = withTimeout(5000);
    const r = await fetch(join("/healthz"), { signal });
    cancel();
    res.status(r.status).type(r.headers.get("content-type") || "application/json");
    res.send(await r.text());
  } catch (e) {
    res
      .status(502)
      .json({ ok: false, error: "GPU unreachable", detail: String(e?.message || e) });
  }
});

// удалить фон → PNG
router.post("/remove-background", upload.single("image"), async (req, res) => {
  if (!needFile(req, res)) return;
  try {
    const r = await postMultipart("/remove-background", req.file);
    res.status(r.status).type(r.headers.get("content-type") || "image/png");
    r.body?.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
  }
});

// сегментация → PNG RGBA
router.post("/segm", upload.single("image"), async (req, res) => {
  if (!needFile(req, res)) return;
  try {
    const r = await postMultipart("/segm", req.file);
    res.status(r.status).type(r.headers.get("content-type") || "image/png");
    r.body?.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
  }
});

// глубина → серый PNG
router.post("/depth", upload.single("image"), async (req, res) => {
  if (!needFile(req, res)) return;
  try {
    const r = await postMultipart("/depth", req.file);
    res.status(r.status).type(r.headers.get("content-type") || "image/png");
    r.body?.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
  }
});

// поза → JSON
router.post("/pose", upload.single("image"), async (req, res) => {
  if (!needFile(req, res)) return;
  try {
    const r = await postMultipart("/pose", req.file);
    res.status(r.status).type(r.headers.get("content-type") || "application/json");
    res.send(await r.text());
  } catch (e) {
    res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
  }
});

// TripoSR → GLB
router.post("/triposr", upload.single("image"), async (req, res) => {
  if (!needFile(req, res)) return;
  try {
    const r = await postMultipart("/triposr", req.file, 120000);
    res
      .status(r.status)
      .type(r.headers.get("content-type") || "model/gltf-binary");
    r.body?.pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
  }
});

// диагностика
router.get("/__target", (_req, res) => res.json({ GPU_URL: GPU_BASE }));

export default router;