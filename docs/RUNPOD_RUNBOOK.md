# RunPod Runbook — ProjectSilk GPU API

## Цель
Поднять GPU API (FastAPI) на pod'е RunPod на порту 8000.
Node/Express на Mac будет проксировать запросы на GPU_URL.

---

## 1) Создание pod (RunPod UI)
- Image: PyTorch + CUDA (runpod/pytorch)
- Disk (pod volume): 50–100GB
- Открыть порты: 8000 (опц. 8888 для Jupyter)

---

## 2) Установка на pod (внутри pod)
```bash
cd /workspace
git clone https://github.com/shirokuumaa/ProjectSilk.git
cd ProjectSilk
bash scripts/pod_bootstrap.sh

