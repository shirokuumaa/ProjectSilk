from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import numpy as np
import onnxruntime as ort
import cv2
from PIL import Image
import io
from pathlib import Path

app = Flask(_name_)
CORS(app)

# --------- пути и модель MODNet ----------
BASE_DIR = Path(_file_).parent
MODEL_PATH = BASE_DIR / "models" / "model.onnx"
if not MODEL_PATH.exists():
    raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

# silicon/CPU ok
session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])

def run_modnet(np_img: np.ndarray) -> Image.Image:
    """Вернёт PNG с альфой (вырезанный фон)."""
    h, w = np_img.shape[:2]
    inp = cv2.resize(np_img, (512, 512)).astype(np.float32) / 255.0
    inp = inp.transpose(2, 0, 1)[None, ...]  # [1,3,512,512]
    input_name = session.get_inputs()[0].name
    out = session.run(None, {input_name: inp})[0]  # (1,1,512,512)
    matte = cv2.resize(out[0, 0], (w, h))
    matte = np.clip(matte, 0.0, 1.0)

    alpha = (matte * 255).astype(np.uint8)
    rgba = np.dstack([np_img, alpha])  # [H,W,4]
    return Image.fromarray(rgba, mode="RGBA")

@app.post("/remove-background")
def remove_background():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400
    file = request.files["image"]
    img = Image.open(file.stream).convert("RGB")
    out_img = run_modnet(np.array(img))
    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")

if _name_ == "_main_":
    app.run(port=5002, debug=True)