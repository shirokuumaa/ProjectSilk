from rembg import new_session

try:
    from triposr.api import TripoSR
    import torch
    HAS_TRIPOSR = True
except ImportError:
    TripoSR = None
    torch = None
    HAS_TRIPOSR = False


def main():
    print("Prewarm rembg...")
    _ = new_session("isnet-general-use")
    print("✅ rembg OK")

    if HAS_TRIPOSR:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Prewarm TripoSR on {device} ...")
        _ = TripoSR.from_pretrained("stabilityai/TripoSR", device=device, dtype="float32")
        print("✅ TripoSR OK")
    else:
        print("⚠️ TripoSR not installed, skip prewarm (это нормально на локальном Маке).")

    print("✨ Prewarm done.")


if __name__ == "__main__":
    main()