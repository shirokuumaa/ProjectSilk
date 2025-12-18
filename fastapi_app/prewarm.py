"""
Prewarm models for Lunbee AI FastAPI service.

Запускается ОДИН раз на GPU-поде (например, во время сборки Docker-образа
или при старте), чтобы заранее скачать и прогреть веса rembg и TripoSR.

Политика:
- ТОЛЬКО тяжёлая rembg-модель isnet-general-use.
- Никаких u2netp / других лёгких моделей.
"""

from rembg import new_session

# Эти переменные заполним, если TripoSR и torch найдутся
HAS_TRIPOSR = False
TripoSR = None
torch = None

# Пытаемся импортировать TripoSR + torch, но НЕ падаем, если их нет
try:
    from triposr.api import TripoSR  # type: ignore
    import torch  # нужен только для проверки cuda и загрузки весов
    HAS_TRIPOSR = True
except Exception as e:
    print("[prewarm] WARN: cannot import TripoSR or torch:", repr(e))
    HAS_TRIPOSR = False


def prewarm_rembg():
    """Скачивает и прогревает ТЯЖЁЛУЮ модель rembg / isnet-general-use."""
    print("[prewarm] rembg / isnet-general-use …")
    # скачает веса в кеш (обычно ~/.u2net или ~/.cache/rembg)
    _ = new_session("isnet-general-use")
    print("[prewarm] rembg OK")


def prewarm_triposr():
    """Скачивает и прогревает TripoSR, если она установлена."""
    if not HAS_TRIPOSR:
        print("[prewarm] skip TripoSR (not installed)")
        return

    # если torch есть, проверяем cuda; иначе просто считаем, что cpu
    device = "cpu"
    try:
      if torch is not None and torch.cuda.is_available():
          device = "cuda"
    except Exception:
      device = "cpu"

    print(f"[prewarm] TripoSR on device={device} …")
    _ = TripoSR.from_pretrained(
        "stabilityai/TripoSR",
        device=device,
        dtype="float32",
    )
    print("[prewarm] TripoSR OK")


def main():
    print("=== Lunbee AI prewarm start ===")
    prewarm_rembg()
    prewarm_triposr()
    print("=== Lunbee AI prewarm done ===")


if __name__ == "__main__":
    main()