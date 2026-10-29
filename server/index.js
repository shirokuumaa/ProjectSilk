// server/index.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

import { UPLOADS_DIR } from './config/paths.js';
import { allowedOrigins } from './config/cors.js';
import productRoutes from './routes/productRoutes.js';
import wardrobeRoutes from './routes/wardrobeRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import avatarRoutes from './routes/avatarRoutes.js';
import bodyProfileRoutes from './routes/bodyProfileRoutes.js';
import authRoutes from './routes/authRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import { resumePatternJobs } from './services/patternJobs.js';


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

/* 0) CORS — ставим самым первым. Адреса — config/cors.js (CORS_ORIGINS).
   credentials: вход хранится в httpOnly-cookie, браузер шлёт её только этим адресам. */
app.use(cors({
  origin: allowedOrigins(),
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
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

/* 3) Статика /uploads (папка — config/paths.js, переносится через UPLOADS_DIR) */
app.use('/uploads', express.static(UPLOADS_DIR));

/* 4) API-роуты */
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/wardrobe', wardrobeRoutes); // ← добавили гардероб
app.use('/api/body-profile', bodyProfileRoutes);
app.use('/api/orders', orderRoutes);   // заказы без оплаты (services/orders.js)

//test front avatar
app.use('/api/avatar', avatarRoutes);

/* Health */
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* Глобальный обработчик ошибок — последним, после всех роутов */
// текст исключения — только в лог; пользователю — общее сообщение
app.use((err, _req, res, _next) => {
  console.error('API error:', err);
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: status === 413 ? 'The request is too large.' : 'Invalid request.' });
  }
  res.status(500).json({ message: 'Something went wrong on our side. Please try again later.' });
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
      // выкройки, которые не успели собраться до перезапуска
      resumePatternJobs().catch((e) => console.error('[patterns] resume failed:', e?.message || e));
    });
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err?.message || err);
    process.exit(1);
  }
})();