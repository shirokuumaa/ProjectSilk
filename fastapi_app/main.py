from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uuid, asyncio, os, shutil

app = FastAPI()
JOBS = {}
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.post("/avatar/start")
async def avatar_start(
    photo: UploadFile = File(...),
    heightCm: int = Form(170),
    bodyType: str = Form("M"),
    skinTone: str = Form("neutral"),
):
    job_id = uuid.uuid4().hex[:12]
    # сохраним загруженное фото (необязательно, но удобно для отладки)
    with open(f"static/{job_id}_photo.png", "wb") as f:
        f.write(await photo.read())

    # поставим задачу в «очередь»
    JOBS[job_id] = {"status": "queued"}
    asyncio.create_task(fake_pipeline(job_id))
    return {"job_id": job_id}

async def fake_pipeline(job_id: str):
    # имитируем расчёты
    await asyncio.sleep(3)

    # положи заранее любой .glb как демо:
    # fastapi_app/static/demo_avatar.glb
    src_glb = "static/demo_avatar.glb"
    dst_glb = f"static/{job_id}.glb"
    if os.path.exists(src_glb):
        shutil.copy(src_glb, dst_glb)
        JOBS[job_id] = {
            "status": "done",
            "glb_url": f"/static/{job_id}.glb",
            "preview_url": None,  # можно добавить PNG превью позже
            "measurements": {"height_cm": 170},
        }
    else:
        JOBS[job_id] = {"status": "error", "message": "demo_avatar.glb not found"}

@app.get("/avatar/status/{job_id}")
async def avatar_status(job_id: str):
    return JOBS.get(job_id, {"status": "queued"})