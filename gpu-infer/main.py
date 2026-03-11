from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from rembg import remove, new_session
import io
import os
import uuid

app = FastAPI(title="ProjectSilk GPU Inference")

# Папки для сохранения результатов
OUTPUT_DIR = "./output_models"
TEMP_DIR = "./temp_images"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

# Загружаем ИИ-модель для удаления фона (isnet-general-use отлично подходит для одежды)
print("Загрузка модели rembg...")
# rembg сам подхватит доступные ресурсы (включая MPS, если onnxruntime поддерживает)
bg_session = new_session("isnet-general-use")
print("Модель готова!")

@app.post("/api/ai/generate-3d")
async def generate_3d(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Нужно загрузить картинку")

    try:
        # 1. Читаем картинку
        image_bytes = await file.read()
        input_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        task_id = str(uuid.uuid4())
        
        # 2. Вырезаем фон (ИИ в действии)
        print(f"[{task_id}] Удаляем фон...")
        no_bg_image = remove(input_image, session=bg_session)
        
        # Делаем белый фон вместо прозрачного (для будущей 3D модели)
        final_image = Image.new("RGB", no_bg_image.size, (255, 255, 255))
        final_image.paste(no_bg_image, mask=no_bg_image.split()[3])
        
        # Сохраняем промежуточный результат, чтобы ты могла его увидеть
        preview_path = os.path.join(TEMP_DIR, f"{task_id}_nobg.jpg")
        final_image.save(preview_path)
        print(f"[{task_id}] Фон удален и сохранен в {preview_path}")

        # 3. Здесь будет запуск TRELLIS
        # Пока ставим заглушку: создаем пустой .glb файл
        output_glb_path = os.path.join(OUTPUT_DIR, f"{task_id}.glb")
        with open(output_glb_path, "w") as f:
            f.write("mock_3d_data")
            
        print(f"[{task_id}] 3D модель сгенерирована!")
        
        # Возвращаем ссылку на скачивание
        return JSONResponse(content={
            "success": True, 
            "task_id": task_id,
            "glb_url": f"http://127.0.0.1:8000/api/ai/download/{task_id}.glb",
            "preview_url": f"http://127.0.0.1:8000/api/ai/preview/{task_id}_nobg.jpg"
        })

    except Exception as e:
        print(f"Ошибка: {e}")
        raise HTTPException(status_code=500, detail="Ошибка обработки ИИ")

@app.get("/api/ai/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="model/gltf-binary", filename=filename)
    raise HTTPException(status_code=404, detail="Файл не найден")

@app.get("/api/ai/preview/{filename}")
async def preview_file(filename: str):
    file_path = os.path.join(TEMP_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="image/jpeg", filename=filename)
    raise HTTPException(status_code=404, detail="Превью не найдено")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)