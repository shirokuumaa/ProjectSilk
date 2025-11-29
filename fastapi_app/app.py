# fastapi_app/app.py

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
import io
import time

from rembg import remove, new_session

# --- optional torch (может отсутствовать) ---
try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
except Exception:
    torch = None
    DEVICE = "cpu"

# ----- paths / folders -----
BASE = Path(__file__).parent.resolve()
OUT = BASE / "static"
(OUT / "bg").mkdir(parents=True, exist_ok=True)
(OUT / "mesh").mkdir(parents=True, exist_ok=True)

# ----- FastAPI app -----
app = FastAPI(title="Lunbee AI API")

# статика (PNG и GLB)
app.mount("/static", StaticFiles(directory=str(OUT)), name="static")

# ----- health -----
@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.get("/health")
async def health():
    return {"ok": True, "device": DEVICE}


# ====== rembg (фон, ТОЛЬКО тяжёлая модель) ======
# Никаких u2netp. Только isnet-general-use.
try:
    REM_SESSION = new_session("isnet-general-use")
    HAS_REMBG = True
    print("[rembg] isnet-general-use loaded OK")
except Exception as e:
    REM_SESSION = None
    HAS_REMBG = False
    print("[rembg] FAILED to init isnet-general-use:", repr(e))


@app.post("/bg_url")
async def bg_url(image: UploadFile = File(...)):
    """
    Удаляем фон и сохраняем PNG в static/bg, возвращаем URL.

    Политика:
    - Если тяжёлая модель isnet-general-use не загрузилась (нет памяти / нет GPU / другая ошибка),
      возвращаем 503. НИКАКИХ лёгких моделей / кода-подмен.
    """
    if REM_SESSION is None:
        raise HTTPException(
            status_code=503,
            detail="Background removal model (isnet-general-use) is not available on this server",
        )

    raw = await image.read()
    out = remove(raw, session=REM_SESSION)

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.png"
    fpath = OUT / "bg" / fname
    with open(fpath, "wb") as f:
        f.write(out)

    url = f"/static/bg/{fname}"
    return {"image_url": url}


# ====== TripoSR (3D реконструкция) ======
HAS_TRIPOSR = False
TRIPO = None

try:
    from trisurf import export_trimesh_to_glb
    from triposr.api import TripoSR

    HAS_TRIPOSR = True
    TRIPO = TripoSR.from_pretrained(
        "stabilityai/TripoSR",
        device=DEVICE,     # "cuda" на GPU-поде, "cpu" на локалке (может быть очень медленно)
        dtype="float32",
    )
    print(f"[TripoSR] loaded on device={DEVICE}")
except Exception as e:
    # Никаких fallback-моделей. Просто отключаем фичу.
    HAS_TRIPOSR = False
    TRIPO = None
    export_trimesh_to_glb = None
    print("[TripoSR] disabled:", repr(e))


@app.post("/recon3d")
async def recon3d(image: UploadFile = File(...)):
    """
    Строим 3D-модель вещи (TripoSR) и сохраняем GLB в static/mesh, возвращаем URL.

    Политика:
    - Если TripoSR не установлен или не поднялся (нет нужного GPU и т.п.) — отдаём 503.
      НИКАКИХ лёгких/упрощённых моделей.
    """
    if TRIPO is None:
        raise HTTPException(
            status_code=503,
            detail="TripoSR 3D reconstruction is not available on this server",
        )

    raw = await image.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    mesh = TRIPO(img)  # TripoSR возвращает trimesh.Trimesh

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.glb"
    fpath = OUT / "mesh" / fname
    export_trimesh_to_glb(mesh, fpath)

    url = f"/static/mesh/{fname}"
    return {"glb_url": url}


# ====== features (что реально включено) ======
@app.get("/features")
async def features():
    """
    Фронт может дернуть /features, чтобы понять какие AI-фичи доступны
    на этом сервере (в зависимости от того, какие модели и GPU подняты).
    """
    return {
        # rembg доступен ТОЛЬКО если загрузилась тяжёлая isnet-general-use
        "rembg": HAS_REMBG,
        # TripoSR — только если реально поднялся
        "triposr": HAS_TRIPOSR,
        # зарезервировано под AR Try-On / Avatar Try-On (отдельный сервис)
        "tryon_ar": False,
        "tryon_avatar": False,
    }