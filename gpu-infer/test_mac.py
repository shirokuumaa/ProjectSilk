import torch

print("Версия PyTorch:", torch.__version__)
if torch.backends.mps.is_available():
    print("УРА! Видеокарта Apple M3 Max найдена и готова к работе (MPS включен) 🚀")
else:
    print("Видеокарта не найдена, вычисления будут идти на слабом процессоре :(")