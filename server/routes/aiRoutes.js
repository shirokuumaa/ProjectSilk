// server/routes/aiRoutes.js
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const router = express.Router();

// Базовый адрес GPU-сервера (FastAPI в папке gpu-infer)
// Важно: в server/.env должно быть GPU_URL=http://127.0.0.1:8000
const RAW_GPU = process.env.GPU_URL || "http://127.0.0.1:8000";

function normalizeGpuBase(raw) {
  const val = String(raw || "").trim();
  if (!val) return "";
  const u = new URL(val);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  // убираем лишние / в конце
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u.toString(); // например "http://127.0.0.1:8000"
}

const GPU_BASE = normalizeGpuBase(RAW_GPU);

// Маппинг путей Node → FastAPI
//
// Node (порт 5050):
//   /api/ai/__target
//   /api/ai/healthz
//   /api/ai/avatar/start
//   /api/ai/avatar/status/:id
//   /api/ai/pose
//   /api/ai/segm
//   /api/ai/remove-background
//   /api/ai/depth
//   /api/ai/triposr
//
// FastAPI (порт 8000):
//   /api/ai/__target
//   /api/ai/healthz
//   /api/ai/avatar/start
//   /api/ai/avatar/status/:id
//   /pose
//   /segm
//   /remove-background
//   /depth
//   /triposr
function mapPath(originalUrl) {
  let url = originalUrl; // уже содержит путь + query, например "/api/ai/pose?x=1"

  if (url.startsWith("/api/ai/pose")) {
    return url.replace("/api/ai/pose", "/pose");
  }
  if (url.startsWith("/api/ai/segm")) {
    return url.replace("/api/ai/segm", "/segm");
  }
  if (url.startsWith("/api/ai/remove-background")) {
    return url.replace("/api/ai/remove-background", "/remove-background");
  }
  if (url.startsWith("/api/ai/depth")) {
    return url.replace("/api/ai/depth", "/depth");
  }
  if (url.startsWith("/api/ai/triposr")) {
    return url.replace("/api/ai/triposr", "/triposr");
  }

  // Остальные пути ( __target, healthz, avatar/* ) оставляем как есть
  return url;
}

// Для себя: быстрая диагностика конфигурации Node-прокси
router.get("/__config", (_req, res) => {
  res.json({
    GPU_URL: GPU_BASE || null,
  });
});

// Универсальный ПРОКСИ для всех запросов на /api/ai/*
// (router.use срабатывает на любой метод и любой под-путь)
router.use(async (req, res) => {
  if (!GPU_BASE) {
    return res
      .status(503)
      .json({ message: "GPU_URL is not configured on API server" });
  }

  // Например: originalUrl = "/api/ai/pose?x=1"
  const mappedPath = mapPath(req.originalUrl);
  const targetUrl = new URL(mappedPath, GPU_BASE).toString();

  const method = req.method;
  const headers = { ...req.headers };
  delete headers.host;           // host ставит сам fetch
  delete headers["content-length"]; // на всякий случай, пусть fetch сам считает

  try {
    const options = { method, headers };

    // GET/HEAD без тела; остальные — стримим тело (multipart, JSON, FormData)
    if (!["GET", "HEAD"].includes(method)) {
      options.body = req;
    }

    const upstream = await fetch(targetUrl, options);

    // Пробрасываем статус и заголовки
    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      res.setHeader(key, value);
    }

    // Тело ответа просто прокидываем дальше
    if (upstream.body) {
      upstream.body.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("AI proxy error:", err);
    res.status(502).json({
      message: "AI upstream error",
      error: String(err?.message || err),
    });
  }
});

export default router;