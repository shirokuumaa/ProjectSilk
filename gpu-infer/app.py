# gpu-infer/app.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import torch, io, numpy as np, cv2
from PIL import Image
from ultralytics import YOLO

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # ← было "", из-за этого шли CORS-ошибки
    allow_methods=["*"],
    allow_headers=["*"],
)

device = "cuda" if torch.cuda.is_available() else "cpu"

# ---- POSE: YOLOv8 (можешь повысить до 'yolov8x-pose.pt' на большой GPU) ----
pose_model = YOLO("yolov8s-pose.pt").to(device)

# ---- SEGMENTATION: Robust Video Matting -------------------------------------
rvm = torch.hub.load("PeterL1n/RobustVideoMatting", "resnet50").to(device).eval()
rec = [None] * 4  # RVM states

# ---- DEPTH: MiDaS DPT-Large -------------------------------------------------
midas = torch.hub.load("intel-isl/MiDaS", "DPT_Large").to(device).eval()
midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms").dpt_transform

def _read_image(upload_file: UploadFile) -> np.ndarray:
    data = upload_file.file.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(img)

@app.get("/healthz")
def healthz():
    return {"ok": True, "device": device}

@app.post("/pose")
async def pose(image: UploadFile = File(...)):
    np_img = _read_image(image)
    res = pose_model.predict(
        np_img, imgsz=640, conf=0.3,
        device=0 if device == "cuda" else None, verbose=False
    )
    kps = []
    if res and len(res[0].keypoints):
        xy = res[0].keypoints.xy[0].cpu().numpy().tolist()     # (17,2)
        cf = res[0].keypoints.conf[0].cpu().numpy().tolist()   # (17,)
        for i, (x, y) in enumerate(xy):
            kps.append({"name": str(i), "x": float(x), "y": float(y), "score": float(cf[i])})
    return JSONResponse({"width": int(np_img.shape[1]), "height": int(np_img.shape[0]), "keypoints": kps})

@app.post("/segm")
async def segm(image: UploadFile = File(...)):
    np_img = _read_image(image)  # HWC, RGB
    frame = torch.from_numpy(np_img).to(device).float() / 255.0
    frame = frame.permute(2, 0, 1).unsqueeze(0)  # 1x3xHxW
    global rec
    with torch.no_grad():
        fgr, pha, *rec = rvm(frame, *rec, downsample_ratio=0.25, max_time=1/30)
    pha = pha[0, 0].clamp(0, 1).cpu().numpy()  # HxW, 0..1

    alpha = (pha * 255).astype(np.uint8)
    rgba = np.dstack([np_img, alpha])  # HxWx4
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")

# совместимость с фронтом: тот же эндпоинт, но зовёт segm
@app.post("/remove-background")
async def remove_background(image: UploadFile = File(...)):
    return await segm(image)

@app.post("/depth")
async def depth(image: UploadFile = File(...)):
    np_img = _read_image(image)
    inp = midas_transforms(Image.fromarray(np_img)).to(device)
    with torch.no_grad():
        pred = midas(inp.unsqueeze(0))
        pred = torch.nn.functional.interpolate(
            pred.unsqueeze(1), size=np_img.shape[:2],
            mode="bicubic", align_corners=False
        ).squeeze().cpu().numpy()
    d = pred - pred.min()
    d = (255 * (d / (d.max() + 1e-8))).astype(np.uint8)
    ok, png = cv2.imencode(".png", d)
    return Response(content=png.tobytes(), media_type="image/png")