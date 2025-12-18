# -------- CPU-образ для локальных тестов --------
    FROM python:3.11-slim

    WORKDIR /app
    
    ENV PYTHONDONTWRITEBYTECODE=1
    ENV PYTHONUNBUFFERED=1
    
    COPY requirements.txt /app/
    RUN pip install --no-cache-dir -r requirements.txt
    
    # скачиваем веса rembg на этапе сборки (чтобы потом не тратить время)
    COPY prewarm.py /app/prewarm.py
    RUN python /app/prewarm.py || true
    
    COPY . /app
    
    EXPOSE 8000
    CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]