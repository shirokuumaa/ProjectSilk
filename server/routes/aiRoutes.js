// server/routes/aiRoutes.js
import express from "express";
import multer from "multer";   
import FormData from "form-data";
import fetch from "node-fetch";
import "dotenv/config";

const router = express.Router();

// ───────────────── Multer (память)
const upload = multer({ storage: multer.memoryStorage() });

/* ───────── helpers ───────── */

// убираем невидимые символы (ZWSP/ZWNJ/ZWJ/BOM/WORD JOINER)
const scrub = (s) => String(s).replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");

// нормализуем GPU_URL (localhost → 127.0.0.1; без хвостовых /, без query/hash)
function normalizeGpuBase(raw) {
  const val = scrub(raw || "").trim();
  if (!val) return "";
  const u = new URL(val);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  u.pathname = scrub(u.pathname).replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u.toString(); // "http://127.0.0.1:8000"
}
const RAW_GPU = process.env.GPU_URL || "";
const GPU_BASE = normalizeGpuBase(RAW_GPU);

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

// проверка файла
function needFile(req, res, fieldName = "image") {
  if (!req.file) {
    res.status(400).json({ ok: false, error: `file required (field "${fieldName}")` });
    return false;
  }
  return true;
}

// POST multipart: один файл
async function postMultipart(path, file, timeoutMs = 30000, fieldName = "image") {
  const fd = new FormData();
  fd.append(fieldName, file.buffer, {
    filename: file.originalname || "file.bin",
    contentType: file.mimetype || "application/octet-stream",
  });
  const headers = fd.getHeaders?.();

  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const url = join(path);
    return await fetch(url, { method: "POST", body: fd, headers, signal });
  } finally {
    cancel();
  }
}

// POST multipart: один файл + дополнительные поля формы
async function postMultipartWithFields(path, file, fields = {}, timeoutMs = 30000, fieldName = "image") {
  const fd = new FormData();
  fd.append(fieldName, file.buffer, {
    filename: file.originalname || "file.bin",
    contentType: file.mimetype || "application/octet-stream",
  });
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  const headers = fd.getHeaders?.();

  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const url = join(path);
    return await fetch(url, { method: "POST", body: fd, headers, signal });
  } finally {
    cancel();
  }
}

/* ───────── режимы ───────── */

const AI_OFF = String(process.env.AI_MODE || "").toLowerCase() === "off" || !GPU_BASE;
console.log(`[AI] Mode: ${AI_OFF ? "OFF (stubs)" : "PROXY"}${GPU_BASE ? ` → ${GPU_BASE}` : ""}`);

/* ───────── routes ───────── */

// healthz — всегда отвечает; в OFF режиме не трогаем GPU
router.get("/healthz", async (_req, res) => {
  if (AI_OFF) {
    return res.json({ ok: true, mode: "off", gpu: false, target: null });
  }
  try {
    const { signal, cancel } = withTimeout(4000);
    const r = await fetch(join("/healthz"), { signal });
    const text = await r.text().catch(() => "");
    cancel();
    res.status(200).json({
      ok: true,
      mode: "proxy",
      gpu: true,
      target: GPU_BASE,
      upstream_status: r.status,
      upstream: text.slice(0, 200),
    });
  } catch (e) {
    res
      .status(200)
      .json({ ok: true, mode: "proxy", gpu: false, target: GPU_BASE, error: String(e?.message || e) });
  }
});

if (AI_OFF) {
  /* ───────── STUB MODE (AI выключен) ───────── */

  // удалить фон → возвращаем исходный файл (чтобы не блокировать UX)
  router.post("/remove-background", upload.single("image"), (req, res) => {
    if (!needFile(req, res)) return;
    res.status(200).type(req.file.mimetype || "application/octet-stream").send(req.file.buffer);
  });

  // заглушки для остальных задач
  const notImpl = (name) => (_req, res) =>
    res.status(501).json({ ok: false, stub: true, error: `${name} unavailable (AI off)` });

  router.post("/segm", upload.single("image"), notImpl("segm"));
  router.post("/depth", upload.single("image"), notImpl("depth"));
  router.post("/pose", upload.single("image"), notImpl("pose"));
  router.post("/triposr", upload.single("image"), notImpl("triposr"));

  // ── Avatar (stub): создаём мок-задачу и помечаем её "done"
  // Положи файлы по путям: server/uploads/stub/avatar.glb и preview.png — тогда фронт увидит результат.
  const jobs = new Map();
  router.post("/avatar/start", upload.single("photo"), (req, res) => {
    if (!needFile(req, res, "photo")) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    jobs.set(id, { status: "processing", progress: 0, preview: null, glb: null });
    setTimeout(() => {
      jobs.set(id, {
        status: "done",
        progress: 1,
        preview: "/uploads/stub/preview.png",
        glb: "/uploads/stub/avatar.glb",
      });
    }, 1500);
    res.json({ ok: true, jobId: id });
  });

  router.get("/avatar/status/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ ok: false, error: "job not found" });
    res.json({ ok: true, ...j });
  });

} else {
  /* ───────── PROXY MODE (GPU включён) ───────── */

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

  // карта глубины → серый PNG
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
      res.status(r.status).type(r.headers.get("content-type") || "model/gltf-binary");
      r.body?.pipe(res);
    } catch (e) {
      res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
    }
  });

  // ── Avatar proxy
  // POST /api/ai/avatar/start  (file field: "photo"; доп. поля формы — heightCm, bodyType, skinTone и т.п.)
  router.post("/avatar/start", upload.single("photo"), async (req, res) => {
    if (!needFile(req, res, "photo")) return;
    try {
      const r = await postMultipartWithFields("/avatar/start", req.file, req.body, 120000, "photo");
      res.status(r.status).type(r.headers.get("content-type") || "application/json");
      res.send(await r.text());
    } catch (e) {
      res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
    }
  });

  // GET /api/ai/avatar/status/:id  → JSON (status/glb/preview/measurements…)
  router.get("/avatar/status/:id", async (req, res) => {
    try {
      const { signal, cancel } = withTimeout(15000);
      const r = await fetch(join(`/avatar/status/${encodeURIComponent(req.params.id)}`), { signal });
      cancel();
      res.status(r.status).type(r.headers.get("content-type") || "application/json");
      res.send(await r.text());
    } catch (e) {
      res.status(500).json({ ok: false, error: "proxy failed", detail: String(e?.message || e) });
    }
  });
}

// диагностика конфигурации
router.get("/__target", (_req, res) =>
  res.json({ GPU_URL: GPU_BASE || null, AI_MODE: AI_OFF ? "off" : "proxy" })
);

export default router;