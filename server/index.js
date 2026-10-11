// server/index.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import productRoutes from './routes/productRoutes.js';
import wardrobeRoutes from './routes/wardrobeRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import avatarRoutes from './routes/avatarRoutes.js';
import bodyProfileRoutes from './routes/bodyProfileRoutes.js';
import authRoutes from './routes/authRoutes.js';


dotenv.config();

const app   = express();
const PORT  = Number(process.env.PORT) || 5050;
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/silk';

/* Без секрета токены подписывать нечем — не стартуем вовсе */
if (String(process.env.JWT_SECRET || '').length < 32) {
  console.error('❌ JWT_SECRET не задан или короче 32 символов. Добавьте его в server/.env (см. server/.env.example).');
  process.exit(1);
}

mongoose.set('strictQuery', true);

/* 0) CORS — ставим самым первым.
   CORS_ORIGINS (через запятую) — для второго экземпляра, например тестового. */
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: CORS_ORIGINS,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
}));

/* Лёгкий лог запросов (помогает ловить «Failed to fetch») */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* 1) AI-прокси — до JSON-парсеров, чтобы не мешать multipart */
app.use('/api/ai', aiRoutes);

/* 2) JSON / urlencoded (multipart не трогаем) */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* 3) Статика /uploads */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

/* 4) API-роуты */
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/wardrobe', wardrobeRoutes); // ← добавили гардероб
app.use('/api/body-profile', bodyProfileRoutes);

//test front avatar
app.use('/api/avatar', avatarRoutes);

/* Health */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* Глобальный обработчик ошибок — последним, после всех роутов */
app.use((err, _req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ message: 'Server error', error: String(err?.message || err) });
});

/* 5) Подключаем Mongo и стартуем HTTP */
(async () => {
  try {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB connected:',
      mongoose.connection.host,
      mongoose.connection.port,
      mongoose.connection.name
    );
    // Express 5 передаёт ошибку запуска (например, занятый порт) в этот колбэк,
    // а не бросает её — без проверки сервер «стартует», ничего не слушая.
    app.listen(PORT, (err) => {
      if (err) {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Порт ${PORT} уже занят другим процессом. Освободите его или задайте другой PORT.`);
        } else {
          console.error('❌ Не удалось запустить HTTP-сервер:', err?.message || err);
        }
        process.exit(1);
      }
      console.log(`API:      http://localhost:${PORT}`);
      console.log(`AI proxy: http://localhost:${PORT}/api/ai`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err?.message || err);
    process.exit(1);
  }
})();