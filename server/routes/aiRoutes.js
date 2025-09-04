// server/routes/aiRoutes.js
import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const AI_BASE = process.env.GPU_URL || 'http://localhost:8000';

async function forwardToAI(path, file) {
  const fd = new FormData();
  fd.append('image', file.buffer, { filename: file.originalname || 'image.png' });

  const resp = await fetch(`${AI_BASE}${path}`, {
    method: 'POST',
    body: fd,
    headers: fd.getHeaders?.(),
  });
  return resp;
}

router.get('/healthz', async (_req, res) => {
  try {
    const r = await fetch(`${AI_BASE}/healthz`);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'GPU unreachable' });
  }
});

// PNG с альфой
router.post('/remove-background', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image' });
    const r = await forwardToAI('/remove-background', req.file);
    if (!r.ok) return res.status(502).json({ message: 'GPU error', code: r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'proxy error' });
  }
});

router.post('/pose', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image' });
    const r = await forwardToAI('/pose', req.file);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ message: 'proxy error' });
  }
});

router.post('/depth', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image' });
    const r = await forwardToAI('/depth', req.file);
    if (!r.ok) return res.status(502).json({ message: 'GPU error', code: r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ message: 'proxy error' });
  }
});

export default router;