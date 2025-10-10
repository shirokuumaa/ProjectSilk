// server/index.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import productRoutes from './routes/productRoutes.js';
import aiRoutes from './routes/aiRoutes.js'; // ← твой AI-прокси (ESM)

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5050;               // ← 5050 по умолчанию
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/silk';

app.use(cors());

// ⬇️ ВАЖНО: AI-роутер ставим ПЕРВЫМ — до любых парсеров тела
app.use('/api/ai', aiRoutes);

// Только потом JSON/urlencoded (иначе «съедят» multipart для multer)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// STATIC /uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Mongo
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB error', err));

// Остальные API
app.use('/api', productRoutes);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API:       http://localhost:${PORT}`);
  console.log(`AI proxy:  http://localhost:${PORT}/api/ai`);
});