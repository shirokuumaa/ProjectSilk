// server/routes/aiRoutes.js
import express from "express";
import { Readable } from "stream";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

/*
 * Весь прокси — только с токеном: каждый запрос может стоить денег на GPU.
 * Лимиты считаются на пользователя, а не на IP:
 *   POST и прочие «тяжёлые» — AI_HEAVY_LIMIT_PER_HOUR (по умолчанию 20 в час),
 *   GET/HEAD (статус, features, готовые файлы, опрос задачи) — AI_LIGHT_LIMIT_PER_HOUR (600).
 */
const isLight = (req) => req.method === "GET" || req.method === "HEAD";
const perUser = (req) => req.user.id;

const aiHeavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AI_HEAVY_LIMIT_PER_HOUR) || 20,
  keyGenerator: perUser,
  skip: isLight,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Hourly AI request limit reached. Please try again later." },
});

const aiLightLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AI_LIGHT_LIMIT_PER_HOUR) || 600,
  keyGenerator: perUser,
  skip: (req) => !isLight(req),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many AI status requests. Please try again later." },
});

router.use(requireAuth, aiHeavyLimiter, aiLightLimiter);

/**
 * AI_MODE:
 *  - off   : AI выключен (не проксируем на GPU, отдаём 503)
 *  - proxy : AI включен, ходим на GPU_URL
 *  - gpu   : то же самое что proxy (удобный alias)
 */
const AI_MODE = String(process.env.AI_MODE || "off").trim().toLowerCase();
const RAW_GPU = String(process.env.GPU_URL || "").trim();

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

const GPU_BASE = normalizeGpuBase(RAW_GPU);

function isAiEnabled() {
  if (AI_MODE === "off") return false;
  if (AI_MODE === "proxy" || AI_MODE === "gpu") return true;
  // если вдруг кто-то поставил левое значение — безопасно выключаем
  return false;
}

// ✅ единый endpoint для фронта (AvatarCreate.jsx ждёт его)
router.get("/__target", (_req, res) => {
  res.json({
    AI_MODE,
    AI_ENABLED: isAiEnabled() && !!GPU_BASE,
    GPU_URL: GPU_BASE || null,
  });
});

// ✅ backward-compat (если где-то ещё осталось)
router.get("/__config", (_req, res) => {
  res.json({
    AI_MODE,
    AI_ENABLED: isAiEnabled() && !!GPU_BASE,
    GPU_URL: GPU_BASE || null,
  });
});

// url тут УЖЕ без "/api/ai", потому что router смонтирован на "/api/ai"
function mapPath(url) {
  return url; // у тебя 1-в-1 совпадают пути с FastAPI
}

router.use(async (req, res) => {
  // 1) AI выключен
  if (!isAiEnabled()) {
    return res.status(503).json({
      message: "AI mode is OFF on API server",
      AI_MODE,
    });
  }

  // 2) AI включен, но GPU_URL не задан
  if (!GPU_BASE) {
    return res.status(503).json({
      message: "GPU_URL is not configured on API server",
      AI_MODE,
    });
  }

  const mappedPath = mapPath(req.url); // "/features", "/avatar/body/anny", ...
  const targetUrl = new URL(mappedPath, GPU_BASE).toString();

  const method = req.method;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  // токен покупателя и куки на GPU-сервер (RunPod) не отправляем
  delete headers.authorization;
  delete headers.cookie;

  try {
    const options = { method, headers };

    // ✅ ВАЖНО: для стрима тела запроса в Node fetch нужен duplex
    if (!["GET", "HEAD"].includes(method)) {
      options.body = req;
      options.duplex = "half";
    }

    const upstream = await fetch(targetUrl, options);

    res.status(upstream.status);

    // fetch уже распаковал тело — старые длина и сжатие стали бы неправдой
    const SKIP = new Set(["transfer-encoding", "content-encoding", "content-length"]);
    for (const [key, value] of upstream.headers.entries()) {
      if (SKIP.has(key.toLowerCase())) continue;
      res.setHeader(key, value);
    }

    // fetch в Node отдаёт web-поток (ReadableStream), у него нет .pipe()
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error("AI proxy error:", err);
    res.status(502).json({
      message: "AI upstream error",
      error: String(err?.message || err),
      AI_MODE,
      GPU_URL: GPU_BASE || null,
    });
  }
});

export default router;