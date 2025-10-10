import express from "express";
import multer from "multer";
import FormData from "form-data";

const app = express();
const upload = multer();
const GPU_URL = process.env.GPU_URL || "http://localhost:8000";

app.get("/api/ai/healthz", async (_req, res) => {
  const r = await fetch(`${GPU_URL}/healthz`); 
  res.status(r.status).type(r.headers.get("content-type") || "application/json");
  res.send(await r.text());
});

app.post("/api/ai/remove-background", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required (field name: image)" });
  const fd = new FormData();
  fd.append("image", req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype,
  });
  const r = await fetch(`${GPU_URL}/remove-background`, { method: "POST", body: fd, headers: fd.getHeaders() });
  res.status(r.status);
  r.body?.pipe(res);
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`dev-quick-ai on http://localhost:${PORT}`));