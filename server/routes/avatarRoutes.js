// server/routes/avatarRoutes.js
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import "dotenv/config";

const router = express.Router();

function normalizeGpuBase(raw) {
  const val = String(raw || "").trim();
  if (!val) return "";

  const withScheme = /^https?:\/\//i.test(val) ? val : `http://${val}`;

  try {
    const u = new URL(withScheme);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    u.pathname = u.pathname.replace(/\/+$/, "");
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

const GPU_BASE = normalizeGpuBase(process.env.GPU_URL || "");

// uploads dir: server/uploads/avatars
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarsDir = path.join(__dirname, "..", "uploads", "avatars");
fs.mkdirSync(avatarsDir, { recursive: true });

// POST /api/avatar/persist
// body: { url: "/static/mesh/xxx.obj" } OR { url: "https://...obj" }
// also accepts: { export_url: "..." }
router.post("/persist", express.json(), async (req, res) => {
  try {
    const url = req.body?.url || req.body?.export_url;
    if (!url) return res.status(400).json({ message: "url (or export_url) is required" });

    // ✅ если уже локальный uploads — ничего не делаем
    if (String(url).startsWith("/uploads/")) {
      return res.json({ localUrl: url, note: "already local" });
    }

    if (!GPU_BASE) return res.status(503).json({ message: "GPU_URL is not configured" });

    // 1) собрать source URL
    let src = "";

    if (String(url).startsWith("/static/")) {
      // relative from FastAPI
      src = new URL(url, GPU_BASE).toString();
    } else if (String(url).startsWith("http://") || String(url).startsWith("https://")) {
      // ✅ Вариант A (строго): разрешаем только тот же host что GPU_BASE
      // Если хочешь разрешить любые https ссылки — скажи, я сниму это ограничение.
      const u = new URL(url);
      const allowed = new URL(GPU_BASE);
      if (u.host !== allowed.host) {
        return res.status(400).json({ message: "Only GPU_URL host is allowed" });
      }
      src = url;
    } else {
      return res.status(400).json({ message: "Unsupported url format" });
    }

    // 2) скачать
    const r = await fetch(src);
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      return res.status(502).json({
        message: "Failed to download",
        status: r.status,
        body: t.slice(0, 300),
      });
    }

    // 3) определить расширение
    const pathname = new URL(src).pathname.toLowerCase();
    let ext = path.extname(pathname);

    if (!ext) {
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("model/gltf-binary") || ct.includes("glb")) ext = ".glb";
      else if (ct.includes("gltf")) ext = ".gltf";
      else ext = ".obj";
    }

    // 4) сохранить потоком
    const fname = `avatar_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
    const outPath = path.join(avatarsDir, fname);

    await pipeline(r.body, fs.createWriteStream(outPath));

    // 5) вернуть локальный URL (Node раздаёт /uploads через express.static)
    return res.json({
      localUrl: `/uploads/avatars/${fname}`,
      sourceUrl: src,
    });
  } catch (e) {
    console.error("persist error:", e);
    return res.status(500).json({
      message: "persist error",
      error: String(e?.message || e),
    });
  }
});

export default router;