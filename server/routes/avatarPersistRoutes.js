import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

const ROOT = process.cwd();
const AV_DIR = path.join(ROOT, "uploads", "avatars");
if (!fs.existsSync(AV_DIR)) fs.mkdirSync(AV_DIR, { recursive: true });

function safeExtFromUrl(u) {
  const clean = String(u || "");
  const m = clean.match(/\.(obj|glb|gltf)\b/i);
  return m ? m[1].toLowerCase() : "obj";
}

// POST /api/avatar/persist
// body: { url: "/static/mesh/xxx.obj" } OR { url: "https://....obj" }
router.post("/persist", express.json(), async (req, res) => {
  try {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ message: "url is required" });

    // если пришёл относительный /static/... — берём через твой же AI proxy,
    // чтобы не париться с GPU_URL и CORS
    const src =
      String(url).startsWith("http://") || String(url).startsWith("https://")
        ? String(url)
        : `http://127.0.0.1:${process.env.PORT || 5050}/api/ai${String(url)}`;

    const r = await fetch(src);
    if (!r.ok) {
      return res.status(502).json({
        message: "failed to download source",
        status: r.status,
        src,
      });
    }

    const ext = safeExtFromUrl(url);
    const fname = `avatar_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const dstPath = path.join(AV_DIR, fname);

    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dstPath, buf);

    return res.json({
      localUrl: `/uploads/avatars/${fname}`,
      bytes: buf.length,
    });
  } catch (e) {
    console.error("persist error:", e);
    return res.status(500).json({ message: "persist error", error: String(e?.message || e) });
  }
});

export default router;