import express from "express";
import multer from "multer";
import FormData from "form-data";

const router = express.Router();
const upload = multer();
const GPU_URL = process.env.GPU_URL || "http://localhost:8000";

router.get("/healthz", async (_req, res) => {
  const r = await fetch(`${GPU_URL}/healthz`);
  res.status(r.status).type(r.headers.get("content-type") || "application/json");
  res.send(await r.text());
});

// поле должно называться "image"
router.post("/remove-background", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required (field name: image)" });

  const fd = new FormData();
  fd.append("image", req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype,
  });

  const r = await fetch(`${GPU_URL}/remove-background`, {
    method: "POST",
    body: fd,
    headers: fd.getHeaders(),
  });

  res.status(r.status);
  r.body?.pipe(res);
});

export default router;