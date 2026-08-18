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
import avatarPersistRoutes from "./routes/avatarPersistRoutes.js";
import bodyProfileRoutes from './routes/bodyProfileRoutes.js';


dotenv.config();

const app   = express();
const PORT  = Number(process.env.PORT) || 5050;
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/silk';

mongoose.set('strictQuery', true);

/* 0) CORS — ставим самым первым */
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
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
app.use('/api/products', productRoutes);
app.use('/api/wardrobe', wardrobeRoutes); // ← добавили гардероб
app.use('/api/body-profile', bodyProfileRoutes);

/* Health & debug */
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/_debug/mongo', (_req, res) =>
  res.json({ uri: MONGO, state: mongoose.connection.readyState })
);

/* Глобальный обработчик ошибок */
app.use((err, _req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ message: 'Server error', error: String(err?.message || err) });
});

//test front avatar
app.use('/api/avatar', avatarRoutes);

app.use("/api/avatar", avatarPersistRoutes);

/* 5) Подключаем Mongo и стартуем HTTP */
(async () => {
  try {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB connected:',
      mongoose.connection.host,
      mongoose.connection.port,
      mongoose.connection.name
    );
    app.listen(PORT, () => {
      console.log(`API:      http://localhost:${PORT}`);
      console.log(`AI proxy: http://localhost:${PORT}/api/ai`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err?.message || err);
    process.exit(1);
  }
})();