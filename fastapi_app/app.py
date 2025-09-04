from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
import io, time, os

# --- ДИРЕКТОРИИ ---
BASE = Path(__file__).parent.resolve()
OUT = BASE / "static"
(OUT / "bg").mkdir(parents=True, exist_ok=True)
(OUT / "mesh").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Lunbee AI API")
app.mount("/static", StaticFiles(directory=str(OUT)), name="static")

# --- DEVICE INFO (для /health) ---
import torch
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ---------- СЕГМЕНТАЦИЯ ФОНА (IS-NET / rembg) ----------
from rembg import remove, new_session

# модель «isnet-general-use» качественнее, чем u2net
REM_SESSION = new_session("isnet-general-use")

@app.post("/bg_url")
async def bg_url(image: UploadFile = File(...)):
    raw = await image.read()
    out = remove(raw, session=REM_SESSION)  # bytes PNG с альфой
    # сохраняем и возвращаем URL файла
    ts = int(time.time()*1000)
    fname = f"{ts}_{image.filename or 'image'}.png"
    fpath = OUT / "bg" / fname
    with open(fpath, "wb") as f:
        f.write(out)
    url = f"/static/bg/{fname}"
    return {"image_url": url}

# ---------- RECON 3D (TripoSR) ----------
# TripoSR ожидает RGB PIL.Image; вернём glb (с UV)
from trisurf import export_trimesh_to_glb  # helper ниже мы реализуем
import numpy as np
import trimesh

# TripoSR API
from triposr.api import TripoSR

TRIPO = TripoSR.from_pretrained(
    "stabilityai/TripoSR",
    device=DEVICE,                 # "cuda" на GPU-VM
    dtype="float32"
)

@app.post("/recon3d")
async def recon3d(image: UploadFile = File(...)):
    # читаем картинку
    raw = await image.read()
    pil = Image.open(io.BytesIO(raw)).convert("RGB")

    # инференс
    mesh = TRIPO(pil)            # получаем trimesh.Trimesh
    # иногда TripoSR даёт лицо «задом наперёд» — нормализуем
    mesh.remove_unreferenced_vertices()
    mesh.remove_degenerate_faces()

    # экспорт glb
    ts = int(time.time()*1000)
    stem = Path(image.filename or "model").stem
    glb_path = OUT / "mesh" / f"{ts}_{stem}.glb"
    export_trimesh_to_glb(mesh, glb_path)

    return {"model_url": f"/static/mesh/{glb_path.name}"}

@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE}