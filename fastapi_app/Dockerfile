# -------- CPU-образ для локальных тестов --------
    FROM python:3.11-slim

    WORKDIR /app
    COPY requirements.txt /app/
    RUN pip install --no-cache-dir -r requirements.txt
    
    # скачиваем веса на этапе сборки (чтобы потом не тратить время)
    COPY prewarm.py /app/prewarm.py
    RUN python /app/prewarm.py || true
    
    COPY . /app
    
    EXPOSE 8000
    CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]