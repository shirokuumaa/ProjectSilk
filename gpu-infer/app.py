# gpu-infer/app.py
import io
import os
import platform
import traceback
from typing import List

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from PIL import Image, ImageFile

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
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload an image file (content-type image/*).")
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

# ───────────────────────── App + CORS
app = FastAPI(title="ProjectSilk GPU API", version="1.2.0")
_client_origin = os.getenv("CLIENT_ORIGIN", "").strip() or "http://localhost:3000"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_client_origin, "http://127.0.0.1:3000", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ───────────────────────── Optional deps
REMBG_OK = False
try:
    from rembg import remove as rembg_remove, new_session as rembg_session
    REMBG_OK = True
except Exception:
    REMBG_OK = False

TRIPOSR_OK = False
try:
    from triposr.api import TripoSR
    import trimesh
    TRIPOSR_OK = True
except Exception:
    TRIPOSR_OK = False

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
        torch.from_numpy(np_img).to(DEVICE).float().div(255.0).permute(2, 0, 1).unsqueeze(0)
    )
    with torch.no_grad():
        fgr, pha, *_rvm_state = _rvm(frame, *_rvm_state, downsample_ratio=0.25)
    alpha = (pha[0, 0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
    rgba = np.dstack([np_img, alpha])
    return Image.fromarray(rgba, "RGBA")

# ───────────────────────── MiDaS depth (устойчиво)
MIDAS_OK, _midas, _apply_midas_transform = False, None, None
if TORCH:
    try:
        _midas = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(DEVICE).eval()
        _trans_mod = torch.hub.load("intel-isl/MiDaS", "transforms")

        def _unwrap_image_tensor(out):
            # dict → возьмём "image" или первый элемент
            if isinstance(out, dict):
                out = out.get("image", next(iter(out.values())))
            # tuple/list → возьмём первый элемент
            if isinstance(out, (list, tuple)):
                out = out[0]
            # к тензору
            if not isinstance(out, torch.Tensor):
                out = torch.as_tensor(out)
            out = out.float()
            # если HWC → CHW
            if out.ndim == 3 and out.shape[-1] in (1, 3) and out.shape[0] not in (1, 3):
                out = out.permute(2, 0, 1)
            # если 1×C×H×W → CHW
            if out.ndim == 4 and out.shape[0] == 1:
                out = out[0]
            return out  # CHW

        def _apply_midas_transform(pil_img: Image.Image):
            """
            Универсальная обёртка: пробуем PIL → dpt_transform, при неудаче — numpy.
            Всегда возвращаем torch.Tensor CHW (float).
            """
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

# ───────────────────────── TripoSR
TRIPO = None
if TRIPOSR_OK:
    try:
        TRIPO_DEVICE = "cuda" if DEVICE == "cuda" else "cpu"  # MPS не поддерживается
        TRIPO = TripoSR.from_pretrained("stabilityai/TripoSR", device=TRIPO_DEVICE)
    except Exception:
        TRIPO = None
        TRIPOSR_OK = False

# ───────────────────────── Startup
@app.on_event("startup")
async def preload_models():
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
            "triposr": TRIPOSR_OK,
        },
    }
    if TORCH:
        try:
            import torch as _t
            info.update(
                torch_version=getattr(t, "__version_", "unknown"),
                cuda_available=bool(getattr(_t, "cuda", None)) and _t.cuda.is_available(),
                cuda_device_count=(_t.cuda.device_count() if hasattr(_t, "cuda") else 0),
                current_device=(_t.cuda.current_device() if hasattr(_t, "cuda") and _t.cuda.is_available() else None),
            )
        except Exception:
            info.update(torch_version="unknown", cuda_available=False, cuda_device_count=0, current_device=None)
    return JSONResponse(info)

# ───────────────────────── Endpoints
@app.post("/pose")
async def pose(image: UploadFile = File(...)):
    if not POSE_OK or _pose_model is None:
        return JSONResponse(status_code=501, content={"error": "YOLO pose is not available on this instance"})
    try:
        pil = _ensure_image(image)
        np_img = _pil_to_numpy_rgb(pil)
        dev_arg = 0 if DEVICE == "cuda" else (None if DEVICE != "cpu" else "cpu")
        res = _pose_model.predict(np_img, imgsz=640, conf=0.3, device=dev_arg, verbose=False)
        kps: List[dict] = []
        if res and len(res[0].keypoints):
            xy = res[0].keypoints.xy[0].cpu().numpy().tolist()
            cf = res[0].keypoints.conf[0].cpu().numpy().tolist()
            for i, (x, y) in enumerate(xy):
                kps.append({"idx": i, "x": float(x), "y": float(y), "score": float(cf[i])})
        return JSONResponse({"w": int(np_img.shape[1]), "h": int(np_img.shape[0]), "keypoints": kps})
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
                buf = io.BytesIO(); jpg.save(buf, format="JPEG", quality=95); buf.seek(0)
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
                buf = io.BytesIO(); jpg.save(buf, format="JPEG", quality=95); buf.seek(0)
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
        inp = _apply_midas_transform(pil)   # CHW float tensor
        inp = inp.to(DEVICE)

        with torch.no_grad():
            pred = _midas(inp.unsqueeze(0))  # B=1 × C × H' × W'
            pred = torch.nn.functional.interpolate(
                pred.unsqueeze(1),
                size=pil.size[::-1],         # (H, W)
                mode="bicubic",
                align_corners=False,
            ).squeeze().cpu().numpy()

        d = pred - pred.min()
        d = (255.0 * (d / (d.max() + 1e-8))).astype(np.uint8)
        return StreamingResponse(io.BytesIO(_png_bytes(Image.fromarray(d, "L"))), media_type="image/png")
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
    

if TRIPOSR_OK and TRIPO is not None:
    @app.post("/triposr")
    async def triposr(image: UploadFile = File(...)):
        try:
            pil = _ensure_image(image).convert("RGB")
            with torch.no_grad():
                mesh_obj = None
                for method_name in ("reconstruct", "infer_pil", "call"):
                    m = getattr(TRIPO, method_name, None)
                    if m:
                        mesh_obj = (TRIPO(pil) if method_name == "call" else m(pil))
                        break
                if mesh_obj is None:
                    raise RuntimeError("Unsupported TripoSR API version")
            mesh = mesh_obj.get("mesh") if isinstance(mesh_obj, dict) else mesh_obj
            if hasattr(mesh, "export"):
                glb_bytes = mesh.export(file_type="glb")
            else:
                verts = getattr(mesh, "vertices", None) or mesh["vertices"]
                faces = getattr(mesh, "faces", None) or mesh["faces"]
                import trimesh as _tm
                tm = _tm.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=False)
                glb_bytes = tm.export(file_type="glb")
            return Response(content=glb_bytes, media_type="model/gltf-binary")
        except Exception as e:
            traceback.print_exc()
            return JSONResponse(status_code=500, content={"error": str(e)})
else:
    @app.post("/triposr")
    async def triposr_unavailable(image: UploadFile = File(...)):
        return JSONResponse(status_code=501, content={"error": "TripoSR is not available on this instance"})