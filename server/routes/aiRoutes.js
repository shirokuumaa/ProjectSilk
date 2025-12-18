// server/routes/aiRoutes.js
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const router = express.Router();

const RAW_GPU = process.env.GPU_URL || "http://127.0.0.1:8000";

function normalizeGpuBase(raw) {
  const val = String(raw || "").trim();
  if (!val) return "";
  const u = new URL(val);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u.toString(); // "http://127.0.0.1:8000"
}

const GPU_BASE = normalizeGpuBase(RAW_GPU);

// url тут УЖЕ без "/api/ai", потому что router смонтирован на "/api/ai"
function mapPath(url) {
  // health/features/avatar — как есть (FastAPI их имеет такими же)
  if (url.startsWith("/healthz")) return url;
  if (url.startsWith("/features")) return url;
  if (url.startsWith("/avatar")) return url;

  // твои existing endpoints на FastAPI тоже совпадают 1-в-1:
  // /pose, /segm, /remove-background, /depth, /triposr
  if (url.startsWith("/pose")) return url;
  if (url.startsWith("/segm")) return url;
  if (url.startsWith("/remove-background")) return url;
  if (url.startsWith("/depth")) return url;
  if (url.startsWith("/triposr")) return url;

  // всё остальное — тоже просто пробрасываем (если есть на FastAPI)
  return url;
}

router.get("/__config", (_req, res) => {
  res.json({ GPU_URL: GPU_BASE || null });
});

router.use(async (req, res) => {
  if (!GPU_BASE) {
    return res.status(503).json({ message: "GPU_URL is not configured on API server" });
  }

  // ВАЖНО: req.url = "/features", "/avatar/body/anny", ...
  const mappedPath = mapPath(req.url);
  const targetUrl = new URL(mappedPath, GPU_BASE).toString();

  const method = req.method;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  try {
    const options = { method, headers };
    if (!["GET", "HEAD"].includes(method)) options.body = req;

    const upstream = await fetch(targetUrl, options);

    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      res.setHeader(key, value);
    }

    if (upstream.body) upstream.body.pipe(res);
    else res.end();
  } catch (err) {
    console.error("AI proxy error:", err);
    res.status(502).json({
      message: "AI upstream error",
      error: String(err?.message || err),
    });
  }
});

export default router;