from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
from typing import Dict, Any, List, Optional
import io
import time
import uuid
import shutil

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
BG_DIR = OUT / "bg"
MESH_DIR = OUT / "mesh"
BG_DIR.mkdir(parents=True, exist_ok=True)
MESH_DIR.mkdir(parents=True, exist_ok=True)

# ----- FastAPI app -----
app = FastAPI(title="Lunbee AI API")

# статика (PNG и GLB/OBJ)
app.mount("/static", StaticFiles(directory=str(OUT)), name="static")

# ----- health -----
@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.get("/health")
async def health():
    return {"ok": True, "device": DEVICE}


# ===================== Avatar jobs (dev in-memory) =====================
JOBS: Dict[str, Dict[str, Any]] = {}

def job_create(job_type: str, payload: Dict[str, Any]) -> str:
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "job_id": job_id,
        "type": job_type,
        "status": "queued",   # queued | running | done | error
        "payload": payload,
        "result": None,
        "error": None,
        "ts": time.time(),
    }
    return job_id

def job_set(job_id: str, **fields):
    if job_id in JOBS:
        JOBS[job_id].update(fields)

def _mesh_url_to_path(mesh_url: str) -> Path:
    """
    Безопасно переводим URL вида /static/mesh/xxx.obj -> путь на диске.
    Запрещаем любые другие пути (защита от path traversal).
    """
    if not isinstance(mesh_url, str):
        raise ValueError("mesh_url must be a string")

    if not mesh_url.startswith("/static/mesh/"):
        raise ValueError("mesh_url must start with /static/mesh/")

    name = mesh_url.replace("/static/mesh/", "", 1)
    if "/" in name or "\\" in name or ".." in name:
        raise ValueError("invalid mesh filename")

    p = (MESH_DIR / name).resolve()
    if not str(p).startswith(str(MESH_DIR.resolve())):
        raise ValueError("invalid path")
    if not p.exists():
        raise FileNotFoundError(f"mesh file not found: {p.name}")
    return p

def write_dummy_obj(params: Dict[str, float]) -> str:
    """
    Пишем простой OBJ (куб) как временный 'body mesh',
    чтобы pipeline Mode 1 можно было тестировать сразу.
    """
    ts = int(time.time() * 1000)
    fname = f"body_dummy_{ts}.obj"
    fpath = MESH_DIR / fname

    obj = """# dummy cube
v -0.5 -0.5 -0.5
v  0.5 -0.5 -0.5
v  0.5  0.5 -0.5
v -0.5  0.5 -0.5
v -0.5 -0.5  0.5
v  0.5 -0.5  0.5
v  0.5  0.5  0.5
v -0.5  0.5  0.5
f 1 2 3
f 1 3 4
f 5 6 7
f 5 7 8
f 1 5 8
f 1 8 4
f 2 6 7
f 2 7 3
f 4 3 7
f 4 7 8
f 1 2 6
f 1 6 5
"""
    fpath.write_text(obj, encoding="utf-8")
    return f"/static/mesh/{fname}"


# ===================== rembg (фон, ТОЛЬКО тяжёлая модель) =====================
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
    if REM_SESSION is None:
        raise HTTPException(
            status_code=503,
            detail="Background removal model (isnet-general-use) is not available on this server",
        )

    raw = await image.read()
    out = remove(raw, session=REM_SESSION)

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.png"
    fpath = BG_DIR / fname
    with open(fpath, "wb") as f:
        f.write(out)

    return {"image_url": f"/static/bg/{fname}"}


# ===================== TripoSR (оставляем на потом) =====================
# Сейчас НЕ обязателен для аватара.
HAS_TRIPOSR = False
TRIPO = None

try:
    from trisurf import export_trimesh_to_glb
    from triposr.api import TripoSR

    HAS_TRIPOSR = True
    TRIPO = TripoSR.from_pretrained(
        "stabilityai/TripoSR",
        device=DEVICE,
        dtype="float32",
    )
    print(f"[TripoSR] loaded on device={DEVICE}")
except Exception as e:
    HAS_TRIPOSR = False
    TRIPO = None
    export_trimesh_to_glb = None
    print("[TripoSR] disabled:", repr(e))


@app.post("/recon3d")
async def recon3d(image: UploadFile = File(...)):
    if TRIPO is None:
        raise HTTPException(
            status_code=503,
            detail="TripoSR 3D reconstruction is not available on this server",
        )

    raw = await image.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    mesh = TRIPO(img)

    ts = int(time.time() * 1000)
    fname = f"{ts}_{image.filename or 'image'}.glb"
    fpath = MESH_DIR / fname
    export_trimesh_to_glb(mesh, fpath)

    return {"glb_url": f"/static/mesh/{fname}"}


# ===================== Aliases for Node proxy compatibility =====================
@app.post("/remove-background")
async def remove_background_alias(image: UploadFile = File(...)):
    return await bg_url(image)

@app.post("/triposr")
async def triposr_alias(image: UploadFile = File(...)):
    return await recon3d(image)


# ===================== Avatar Mode 1 (RPM-like) — API каркас =====================

@app.get("/avatar/job/{job_id}")
async def avatar_job_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.post("/avatar/head/lam")
async def avatar_head_lam(background: BackgroundTasks, files: List[UploadFile] = File(...)):
    """
    multipart: files=face1.jpg, files=face2.jpg ...
    Пока заглушка: создаём job и ставим error (модель не подключена).
    """
    names = [f.filename for f in files]
    job_id = job_create("head_lam", {"files": names})
    job_set(job_id, status="running")

    def _run():
        job_set(job_id, status="error", error="LAM head model is not connected yet (placeholder)")

    background.add_task(_run)
    return {"job_id": job_id, "status": "queued"}


@app.post("/avatar/body/anny")
async def avatar_body_anny(payload: Dict[str, Any]):
    """
    Сейчас: dummy OBJ.
    Потом заменим на реальную Anny.
    """
    params = (payload or {}).get("params") or {}
    body_url = write_dummy_obj(params)
    return {
        "body_mesh_url": body_url,
        "params_used": params,
        "note": "dummy OBJ for pipeline testing; will be replaced by Anny"
    }


@app.post("/avatar/rig")
async def avatar_rig(background: BackgroundTasks, payload: Dict[str, Any]):
    """
    СЕЙЧАС: рабочий placeholder rig.
    Он копирует body OBJ -> rigged_dummy_*.obj и завершает job как done.
    """
    job_id = job_create("rig", payload or {})
    job_set(job_id, status="running")

    body_mesh_url = (payload or {}).get("body_mesh_url")
    head_glb_url = (payload or {}).get("head_glb_url")  # пока не используем, оставлено на будущее

    def _run():
        try:
            if not body_mesh_url:
                raise ValueError("body_mesh_url is required")

            src = _mesh_url_to_path(body_mesh_url)

            ts = int(time.time() * 1000)
            out_name = f"rigged_dummy_{ts}.obj"
            dst = (MESH_DIR / out_name).resolve()

            shutil.copyfile(src, dst)

            result = {
                "rigged_mesh_url": f"/static/mesh/{out_name}",
                "note": "placeholder rig: just copied body mesh; will be replaced by real rigging model",
                "head_glb_url_used": head_glb_url,
            }
            job_set(job_id, status="done", result=result)
        except Exception as e:
            job_set(job_id, status="error", error=str(e))

    background.add_task(_run)
    return {"job_id": job_id, "status": "queued"}


@app.post("/avatar/export")
async def avatar_export(payload: Dict[str, Any]):
    """
    Сейчас просто возвращает URL того, что уже есть (rigged mesh).
    """
    # поддержим оба ключа, чтобы не путаться
    rigged = (payload or {}).get("rigged_glb_url") or (payload or {}).get("rigged_mesh_url")
    fmt = (payload or {}).get("format", "obj")
    if not rigged:
        raise HTTPException(status_code=400, detail="rigged_mesh_url (or rigged_glb_url) is required")
    return {"export_url": rigged, "format": fmt}


# ===================== features (что реально включено) =====================
@app.get("/features")
async def features():
    return {
        "rembg": HAS_REMBG,
        "triposr": HAS_TRIPOSR,

        # Mode 1 Avatar API каркас
        "tryon_avatar": True,
        "avatar_mode1": {
            "head_lam": False,     # пока заглушка
            "body_params": True,   # dummy obj работает
            "rig": True,           # placeholder rig работает
            "export": True
        },

        "tryon_ar": False,
    }