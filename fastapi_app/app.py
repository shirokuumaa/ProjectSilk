from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
import io
import time
import os

from rembg import remove, new_session
import torch
from trisurf import export_trimesh_to_glb  # helper for GLB export


# ---------- paths / folders ----------
BASE = Path(_file_).parent.resolve()
OUT = BASE / "static"
(OUT / "bg").mkdir(parents=True, exist_ok=True)
(OUT / "mesh").mkdir(parents=True, exist_ok=True)


# ---------- FastAPI app ----------
app = FastAPI(title="Lunbee AI API")

# статика (PNG и GLB будут лежать здесь)
app.mount("/static", StaticFiles(directory=str(OUT)), name="static")


# ---------- healthcheck для Node-прокси ----------
@app.get("/healthz")
async def healthz():
    return {"ok": True}


# Дополнительный health для отладки (показывает, видит ли сервер CUDA)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


@app.get("/health")
async def health():
    return {"ok": True, "device": DEVICE}


# ---------- rembg (фон) ----------
REM_SESSION = new_session("isnet-general-use")


@app.post("/bg_url")
async def bg_url(image: UploadFile = File(...)):
    """
    Удаляем фон и сохраняем PNG в static/bg, возвращаем URL.
    """
    raw = await image.read()
    out = remove(raw, session=REM_SESSION)

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.png"
    fpath = OUT / "bg" / fname
    with open(fpath, "wb") as f:
        f.write(out)

    url = f"/static/bg/{fname}"
    return {"image_url": url}


# ---------- TripoSR (3D реконструкция) ----------
HAS_TRIPOSR = False
try:
    from triposr.api import TripoSR
    HAS_TRIPOSR = True
except Exception:
    TripoSR = None
    HAS_TRIPOSR = False


if HAS_TRIPOSR:
    TRIPO = TripoSR.from_pretrained(
        "stabilityai/TripoSR",
        device=DEVICE,   # "cuda" на GPU, "cpu" локально
        dtype="float32",
    )
else:
    TRIPO = None


@app.post("/recon3d")
async def recon3d(image: UploadFile = File(...)):
    """
    Строим 3D-модель вещи и сохраняем GLB в static/mesh, возвращаем URL.
    Если TripoSR не установлен (локально или на слабом сервере) — даём 503.
    """
    if TRIPO is None:
        raise HTTPException(
            status_code=503,
            detail="TripoSR not available on this server",
        )

    raw = await image.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    mesh = TRIPO(img)  # TripoSR возвращает trimesh

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.glb"
    fpath = OUT / "mesh" / fname
    export_trimesh_to_glb(mesh, fpath)

    url = f"/static/mesh/{fname}"
    return {"glb_url": url}