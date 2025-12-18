# gpu-infer/gpu_app.py

import io
import os
import platform
import traceback
import base64
import uuid
import sys
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from PIL import Image, ImageFile, ImageDraw, ImageFont

ImageFile.LOAD_TRUNCATED_IMAGES = True

# ───────────────────────── Torch / device / dtype
TORCH = True
try:
    import torch
except Exception:
    TORCH = False


def pick_device() -> str:
    if TORCH and torch.cuda.is_available():
        return "cuda"
    if TORCH and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


DEVICE = pick_device()
if TORCH:
    REQUESTED_PREC = os.getenv("MODEL_PRECISION", "fp16").lower()
    DTYPE = torch.float16 if (DEVICE == "cuda" and REQUESTED_PREC == "fp16") else torch.float32
else:
    REQUESTED_PREC = "fp32"
    DTYPE = None


# ───────────────────────── Utils
def _ensure_image(file: UploadFile) -> Image.Image:
    """
    Надёжно прочитать картинку из UploadFile.

    ВАЖНО:
    - НЕ проверяем file.content_type (curl и браузеры часто шлют application/octet-stream),
    - просто читаем байты и пробуем открыть через PIL,
    - если не получилось — бросаем 400.
    """
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot decode image.")


def _png_bytes(pil_img: Image.Image) -> bytes:
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _pil_to_numpy_rgb(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("RGB"))


def _composite_on_bg(rgba: Image.Image, color="white") -> Image.Image:
    bg = Image.new("RGB", rgba.size, color)
    bg.paste(rgba, mask=rgba.split()[-1])
    return bg


def _to_data_url_jpeg(pil_img: Image.Image) -> str:
    """Сохранить PIL как data:image/jpeg;base64,... для превью аватара."""
    buf = io.BytesIO()
    pil_img.convert("RGB").save(buf, format="JPEG", quality=90)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


# ───────────────────────── App + CORS
app = FastAPI(title="ProjectSilk GPU API", version="1.3.0")
_client_origin = os.getenv("CLIENT_ORIGIN", "").strip() or "http://localhost:3000"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_client_origin, "http://127.0.0.1:3000", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ───────────────────────── Optional deps: rembg
REMBG_OK = False
try:
    from rembg import remove as rembg_remove, new_session as rembg_session

    REMBG_OK = True
except Exception:
    REMBG_OK = False


# ───────────────────────── Optional deps: TripoSR (локальный клон)
TRIPOSR_OK: bool = False
TRIPO_DEVICE: Optional[str] = None
TSR_MODEL = None
to_gradio_3d_orientation = None

print("========== [TripoSR] INIT BLOCK START ==========")

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_TRIPOSR_DIR = os.path.join(THIS_DIR, "TripoSR")

print(f"[TripoSR] THIS_DIR={THIS_DIR}")
print(f"[TripoSR] LOCAL_TRIPOSR_DIR={LOCAL_TRIPOSR_DIR}, exists={os.path.isdir(LOCAL_TRIPOSR_DIR)}")

if os.path.isdir(LOCAL_TRIPOSR_DIR) and LOCAL_TRIPOSR_DIR not in sys.path:
    sys.path.insert(0, LOCAL_TRIPOSR_DIR)
    print(f"[TripoSR] Added to sys.path: {LOCAL_TRIPOSR_DIR}")
else:
    print("[TripoSR] WARNING: TripoSR folder not found or already in sys.path")

try:
    # tsr/ лежит внутри локального репо TripoSR
    from tsr.system import TSR  # type: ignore
    from tsr.utils import to_gradio_3d_orientation as _to_gradio_3d_orientation  # type: ignore
    import trimesh  # noqa: F401

    to_gradio_3d_orientation = _to_gradio_3d_orientation
    TRIPOSR_OK = True
    print("[TripoSR] tsr imported OK.")
except Exception as e:
    print("[TripoSR] tsr import failed:", repr(e))
    TRIPOSR_OK = False
    TSR_MODEL = None

# ───────────────────────── TripoSR: инициализация модели
if TRIPOSR_OK and TORCH:
    try:
        TRIPO_DEVICE = "cuda" if DEVICE == "cuda" else "cpu"
        print(f"[TripoSR] Initializing TSR model on device={TRIPO_DEVICE} ...")

        TSR_MODEL = TSR.from_pretrained(
            "stabilityai/TripoSR",
            config_name="config.yaml",
            weight_name="model.ckpt",
        )

        if hasattr(TSR_MODEL, "renderer"):
            try:
                TSR_MODEL.renderer.set_chunk_size(131072)
            except Exception as e:
                print("[TripoSR] renderer.set_chunk_size error:", repr(e))

        TSR_MODEL.to(TRIPO_DEVICE)
        print("[TripoSR] Model loaded successfully.")
    except Exception as e:
        print("[TripoSR] init failed:", repr(e))
        TRIPOSR_OK = False
        TSR_MODEL = None
else:
    print(f"[TripoSR] Disabled or torch unavailable: TRIPOSR_OK={TRIPOSR_OK}, TORCH={TORCH}")

print(
    f"[TripoSR] FINAL FLAGS: TRIPOSR_OK={TRIPOSR_OK}, "
    f"TSR_MODEL is None={TSR_MODEL is None if 'TSR_MODEL' in globals() else 'N/A'}, "
    f"TRIPO_DEVICE={TRIPO_DEVICE}"
)
print("========== [TripoSR] INIT BLOCK END ==========")


# ───────────────────────── YOLO Pose
POSE_OK, _pose_model = False, None
try:
    from ultralytics import YOLO

    _pose_model = YOLO(os.getenv("YOLO_POSE_WEIGHTS", "yolov8s-pose.pt"))
    if DEVICE == "cuda":
        _pose_model.to("cuda")
    POSE_OK = True
except Exception:
    _pose_model = None
    POSE_OK = False

# ───────────────────────── RVM (matting)
RVM_OK, _rvm = False, None
_rvm_state = [None] * 4
if TORCH:
    try:
        _rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "resnet50").to(DEVICE).eval()
        RVM_OK = True
    except Exception:
        _rvm = None
        RVM_OK = False


def _rvm_rgba(np_img: np.ndarray) -> Image.Image:
    """Вернуть RGBA через RVM (внутренний хелпер)."""
    global _rvm_state
    frame = (
        torch.from_numpy(np_img)
        .to(DEVICE)
        .float()
        .div(255.0)
        .permute(2, 0, 1)
        .unsqueeze(0)
    )
    with torch.no_grad():
        fgr, pha, *_rvm_state = _rvm(frame, *_rvm_state, downsample_ratio=0.25)
    alpha = (pha[0, 0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
    rgba = np.dstack([np_img, alpha])
    return Image.fromarray(rgba, "RGBA")


# ───────────────────────── MiDaS depth
MIDAS_OK, _midas, _apply_midas_transform = False, None, None
if TORCH:
    try:
        _midas = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(DEVICE).eval()
        _trans_mod = torch.hub.load("intel-isl/MiDaS", "transforms")

        def _unwrap_image_tensor(out):
            if isinstance(out, dict):
                out = out.get("image", next(iter(out.values())))
            if isinstance(out, (list, tuple)):
                out = out[0]
            if not isinstance(out, torch.Tensor):
                out = torch.as_tensor(out)
            out = out.float()
            if out.ndim == 3 and out.shape[-1] in (1, 3) and out.shape[0] not in (1, 3):
                out = out.permute(2, 0, 1)
            if out.ndim == 4 and out.shape[0] == 1:
                out = out[0]
            return out  # CHW

        def _apply_midas_transform(pil_img: Image.Image):
            img = pil_img.convert("RGB")
            tf = getattr(_trans_mod, "dpt_transform", _trans_mod)
            try:
                out = tf(img)
            except Exception:
                out = tf(np.array(img))
            return _unwrap_image_tensor(out)

        MIDAS_OK = True
    except Exception:
        MIDAS_OK, _midas, _apply_midas_transform = False, None, None

# ───────────────────────── In-memory avatar jobs (stub)
AVATAR_JOBS: dict[str, dict] = {}


# ───────────────────────── Startup
@app.on_event("startup")
async def preload_models():
    # Все модели уже лениво / при импорте инициализируются выше.
    pass


# ───────────────────────── Health
@app.get("/healthz")
def healthz():
    info = {
        "status": "ok",
        "host": platform.node(),
        "device": DEVICE,
        "torch_available": TORCH,
        "precision": REQUESTED_PREC,
        "pipelines": {
            "pose": POSE_OK,
            "segm_rvm": RVM_OK,
            "rembg": REMBG_OK,
            "depth_midas": MIDAS_OK,
            "triposr": bool(TRIPOSR_OK and TSR_MODEL is not None),
        },
    }
    if TORCH:
        try:
            import torch as _t

            info.update(
                torch_version=getattr(_t, "__version__", "unknown"),
                cuda_available=bool(getattr(_t, "cuda", None)) and _t.cuda.is_available(),
                cuda_device_count=(_t.cuda.device_count() if hasattr(_t, "cuda") else 0),
                current_device=(
                    _t.cuda.current_device()
                    if hasattr(_t, "cuda") and _t.cuda.is_available()
                    else None
                ),
            )
        except Exception:
            info.update(
                torch_version="unknown",
                cuda_available=False,
                cuda_device_count=0,
                current_device=None,
            )
    return JSONResponse(info)


# алиас, чтобы Node-прокси мог дергать /api/ai/healthz
@app.get("/api/ai/healthz")
def healthz_api():
    return healthz()


# ───────────────────────── AI mode (__target)
@app.get("/api/ai/__target")
def ai_target():
    """
    AvatarCreate смотрит сюда:
    - "off" — аватар отключён (prod, когда нет GPU/модели),
    - "gpu" — реальный тяжёлый сервис,
    - "proxy" — зарезервировано.
    По умолчанию OFF, чтобы Mac не притворялся GPU-инстансом.
    """
    env_mode = os.getenv("AI_MODE", "").strip().lower()
    if env_mode in ("off", "gpu", "proxy"):
        mode = env_mode
    else:
        mode = "off"
    return {"AI_MODE": mode}


# ───────────────────────── Avatar generation (stub)
@app.post("/api/ai/avatar/start")
async def avatar_start(
    photos: Optional[List[UploadFile]] = File(None, alias="photos[]"),
    photo: Optional[UploadFile] = File(None),
    heightCm: Optional[str] = Form(None),
    chest: Optional[str] = Form(None),
    waist: Optional[str] = Form(None),
    hips: Optional[str] = Form(None),
    shoulders: Optional[str] = Form(None),
    inseam: Optional[str] = Form(None),
    shoe: Optional[str] = Form(None),
    bodyType: Optional[str] = Form(None),
    skinTone: Optional[str] = Form(None),
    hair: Optional[str] = Form(None),
    style: Optional[str] = Form(None),
):
    """
    STUB: запуск «генерации» аватара.
    """

    files: List[UploadFile] = []
    if photos:
        files.extend([f for f in photos if f is not None])
    if photo is not None:
        files.append(photo)

    img: Optional[Image.Image] = None

    if files:
        first = files[0]
        try:
            img = _ensure_image(first)
        except HTTPException as e:
            print("[avatar_start] _ensure_image HTTPException:", e.detail)
        except Exception as e:
            print("[avatar_start] _ensure_image unexpected error:", repr(e))

    if img is None:
        w, h = 512, 640
        img = Image.new("RGB", (w, h), (40, 40, 40))
        draw = ImageDraw.Draw(img)
        text = "STUB AVATAR"
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None

        x = w // 2
        y = h // 2
        try:
            if hasattr(draw, "textbbox"):
                bbox = draw.textbbox((0, 0), text, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                x = (w - tw) // 2
                y = (h - th) // 2
        except Exception:
            pass

        draw.text((x, y), text, fill=(230, 230, 230), font=font)

    preview_data_url = _to_data_url_jpeg(img)
    job_id = uuid.uuid4().hex

    AVATAR_JOBS[job_id] = {
        "status": "done",
        "progress": 1.0,
        "previewUrl": preview_data_url,
        "glb": "/uploads/stub/avatar.glb",
        "message": "Stub avatar (no real GPU avatar model yet).",
        "meta": {
            "heightCm": heightCm,
            "chest": chest,
            "waist": waist,
            "hips": hips,
            "shoulders": shoulders,
            "inseam": inseam,
            "shoe": shoe,
            "bodyType": bodyType,
            "skinTone": skinTone,
            "hair": hair,
            "style": style,
        },
    }

    return {"jobId": job_id}


@app.get("/api/ai/avatar/status/{job_id}")
async def avatar_status(job_id: str):
    job = AVATAR_JOBS.get(job_id)
    if not job:
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": "avatar job not found"},
        )
    return JSONResponse(job)


# ───────────────────────── Endpoints: pose / segm / remove-background / depth
@app.post("/pose")
async def pose(image: UploadFile = File(...)):
    if not POSE_OK or _pose_model is None:
        return JSONResponse(status_code=501, content={"error": "YOLO pose is not available on this instance"})
    try:
        pil = _ensure_image(image)
        np_img = _pil_to_numpy_rgb(pil)

        dev_arg = 0 if DEVICE == "cuda" else (None if DEVICE != "cpu" else "cpu")

        res = _pose_model.predict(
            np_img,
            imgsz=640,
            conf=0.3,
            device=dev_arg,
            verbose=False,
        )

        kps: List[dict] = []
        if res:
            r0 = res[0]
            kp = getattr(r0, "keypoints", None)

            if kp is not None and getattr(kp, "xy", None) is not None and len(kp.xy):
                xy_t = kp.xy[0]
                xy = xy_t.cpu().numpy().tolist()

                conf_t = getattr(kp, "conf", None)
                if conf_t is not None:
                    conf_t = conf_t[0]
                    cf = conf_t.cpu().numpy().tolist()
                else:
                    cf = [1.0] * len(xy)

                for i, (x, y) in enumerate(xy):
                    score = float(cf[i]) if i < len(cf) else 1.0
                    kps.append(
                        {
                            "idx": i,
                            "x": float(x),
                            "y": float(y),
                            "score": score,
                        }
                    )

        return JSONResponse(
            {
                "w": int(np_img.shape[1]),
                "h": int(np_img.shape[0]),
                "keypoints": kps,
            }
        )
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/segm")
async def segm(image: UploadFile = File(...)):
    if not (TORCH and RVM_OK and _rvm is not None):
        return JSONResponse(status_code=501, content={"error": "RVM is not available on this instance"})
    try:
        pil = _ensure_image(image)
        np_img = _pil_to_numpy_rgb(pil)
        rgba = _rvm_rgba(np_img)
        return StreamingResponse(io.BytesIO(_png_bytes(rgba)), media_type="image/png")
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


# rembg приоритетно, затем RVM; preview=1 вернёт JPEG на белом фоне
if REMBG_OK:
    _rembg = rembg_session("isnet-general-use")

    @app.post("/remove-background")
    async def remove_background(image: UploadFile = File(...), preview: bool = Query(False)):
        try:
            pil = _ensure_image(image)  # RGBA
            out = rembg_remove(pil, session=_rembg)
            if isinstance(out, bytes):
                rgba = Image.open(io.BytesIO(out)).convert("RGBA")
            else:
                rgba = out.convert("RGBA")
            if preview:
                jpg = _composite_on_bg(rgba, "white")
                buf = io.BytesIO()
                jpg.save(buf, format="JPEG", quality=95)
                buf.seek(0)
                return StreamingResponse(buf, media_type="image/jpeg")
            return StreamingResponse(io.BytesIO(_png_bytes(rgba)), media_type="image/png")
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"error": str(e)})
else:

    @app.post("/remove-background")
    async def remove_background(image: UploadFile = File(...), preview: bool = Query(False)):
        if not (TORCH and RVM_OK and _rvm is not None):
            return JSONResponse(status_code=501, content={"error": "rembg/RVM are not available on this instance"})
        try:
            pil = _ensure_image(image)
            np_img = _pil_to_numpy_rgb(pil)
            rgba = _rvm_rgba(np_img)
            if preview:
                jpg = _composite_on_bg(rgba, "white")
                buf = io.BytesIO()
                jpg.save(buf, format="JPEG", quality=95)
                buf.seek(0)
                return StreamingResponse(buf, media_type="image/jpeg")
            return StreamingResponse(io.BytesIO(_png_bytes(rgba)), media_type="image/png")
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/depth")
async def depth(image: UploadFile = File(...)):
    if not (TORCH and MIDAS_OK and _midas is not None and _apply_midas_transform is not None):
        return JSONResponse(status_code=501, content={"error": "MiDaS is not available on this instance"})
    try:
        pil = _ensure_image(image).convert("RGB")
        inp = _apply_midas_transform(pil)  # CHW float tensor
        inp = inp.to(DEVICE)

        with torch.no_grad():
            pred = _midas(inp.unsqueeze(0))
            pred = torch.nn.functional.interpolate(
                pred.unsqueeze(1),
                size=pil.size[::-1],
                mode="bicubic",
                align_corners=False,
            ).squeeze().cpu().numpy()

        d = pred - pred.min()
        d = (255.0 * (d / (d.max() + 1e-8))).astype(np.uint8)
        return StreamingResponse(io.BytesIO(_png_bytes(Image.fromarray(d, "L"))), media_type="image/png")
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


# ───────────────────────── TripoSR endpoint
if TRIPOSR_OK and TSR_MODEL is not None and TRIPO_DEVICE is not None and to_gradio_3d_orientation is not None:

    @app.post("/triposr")
    async def triposr(image: UploadFile = File(...), resolution: int = Query(256, ge=32, le=320)):
        """
        Принимает картинку, прогоняет через TripoSR и возвращает GLB-модель.
        resolution — Marching Cubes resolution (лучше качество -> больше память/время).
        """
        if not TORCH:
            return JSONResponse(status_code=501, content={"error": "torch is not available"})

        try:
            pil = _ensure_image(image).convert("RGB")

            with torch.no_grad():
                scene_codes = TSR_MODEL(pil, device=TRIPO_DEVICE)
                mesh_list = TSR_MODEL.extract_mesh(scene_codes, resolution=resolution)
                mesh = mesh_list[0] if isinstance(mesh_list, (list, tuple)) else mesh_list
                mesh = to_gradio_3d_orientation(mesh)

                buf = io.BytesIO()
                mesh.export(file_obj=buf, file_type="glb")
                buf.seek(0)
                glb_bytes = buf.read()

            return Response(content=glb_bytes, media_type="model/gltf-binary")
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"error": str(e)})
else:

    @app.post("/triposr")
    async def triposr_unavailable(image: UploadFile = File(...), resolution: int = Query(256)):
        return JSONResponse(status_code=501, content={"error": "TripoSR is not available on this instance"})