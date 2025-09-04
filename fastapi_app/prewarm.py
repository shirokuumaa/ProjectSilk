# Запускаем ОДИН раз при сборке образа, чтобы модели/веса подкачались
from rembg import new_session
from triposr.api import TripoSR
import torch

def main():
    print("Prewarm rembg...")
    _ = new_session("isnet-general-use")   # подкачает веса в кеш

    print("Prewarm TripoSR...")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    _ = TripoSR.from_pretrained("stabilityai/TripoSR", device=device, dtype="float32")
    print("Done.")

if __name__ == "_main_":
    main()