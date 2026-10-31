#!/usr/bin/env bash
# One RunPod session for avatar step C (README «Сеанс на поде»):
#   A. TRELLIS.2-4B (512 and 1024 cascade) and Stable Fast 3D on the 10 product photos (research/photos/accessories);
#   B. previews of every model (Blender Cycles) and one sheet;
#   C. the catalogue picture of the gingham demo dress (size S, Cycles, 600x800);
#   D. back and side pictures of all six demo products (size S, Cycles, 600x800) for the product gallery.
# ~50-65 min on an A40.
#
# Machine: RunPod A40 48 GB (or L40S 48 GB), template RunPod PyTorch 2.4 (CUDA 12.4 devel), Container Disk 80 GB,
# no Network Volume, SSH; environment variable HF_TOKEN (a RunPod secret) whose account was granted access to
# facebook/dinov3-vitl16-pretrain-lvd1689m, briaai/RMBG-2.0 and stabilityai/stable-fast-3d.
#
# On the pod:
#   mkdir -p /workspace/ProjectSilk && tar xzf accessories_inputs.tar.gz -C /workspace/ProjectSilk
#   cd /workspace/ProjectSilk && bash research/accessories/pod/run_session.sh
# Then copy research/accessories/runs/session1.tar.gz back to the Mac (unpacks into research/accessories/runs/).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
POD="$ROOT/research/accessories/pod"
PHOTOS="$ROOT/research/photos/accessories"
OUT="$ROOT/research/accessories/runs/session1"
W=/workspace
PRICE=${PRICE:-0.44}                    # $/ч, только для отчёта
TRELLIS2_COMMIT=75fbf0183001ed9876c8dbb35de6b68552ee08bd
SF3D_COMMIT=ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2
BLENDER=blender-5.0.1-linux-x64
START=$(date +%s)
mkdir -p "$OUT"
exec > >(tee -a "$OUT/session.log") 2>&1
stamp() { echo "== $(date -u +%H:%M:%S) UTC, +$(( ($(date +%s) - START) / 60 )) min: $*"; }

stamp "GPU"
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv
CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)
export TORCH_CUDA_ARCH_LIST="$CAP" MAX_JOBS=$(nproc)
export PATH="/usr/local/cuda/bin:$PATH" CUDA_HOME=/usr/local/cuda   # в образе RunPod nvcc не в PATH

# доступ к закрытым весам проверяется сразу, но сборка окружений идёт и без него: прогоны моделей
# ждут доступа до ACCESS_WAIT минут (токен можно ввести на поде: hf auth login); картинки Blender — в любом случае
stamp "access to the gated weights"
pip install -q "huggingface_hub>=0.34" uv
python "$POD/check_access.py" || echo "!! no access yet — the models will wait for it (hf auth login on the pod)"

stamp "system packages"
apt-get update -qq && apt-get install -y -qq libjpeg-dev libgl1 libxi6 libxrender1 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 >/dev/null

# ── A1. TRELLIS.2: torch 2.6 (cu124) в своём окружении ──
stamp "TRELLIS.2 environment"
git clone -q https://github.com/microsoft/TRELLIS.2.git "$W/TRELLIS.2" && git -C "$W/TRELLIS.2" checkout -q "$TRELLIS2_COMMIT" \
  && git -C "$W/TRELLIS.2" submodule update -q --init --recursive   # Eigen для o-voxel
uv venv -q "$W/venv_t2" --python 3.11
T2="$W/venv_t2/bin/python"
uv pip install -q -p "$T2" torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
uv pip install -q -p "$T2" setuptools wheel ninja imageio imageio-ffmpeg tqdm easydict opencv-python-headless trimesh \
  "transformers==4.57.1" tensorboard pandas lpips zstandard kornia timm pillow "huggingface_hub>=0.34" \
  "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"
PYV=$("$T2" -c "import sys; print(f'cp{sys.version_info[0]}{sys.version_info[1]}')")
uv pip install -q -p "$T2" "https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-${PYV}-${PYV}-linux_x86_64.whl" \
  || { echo "!! no flash-attn wheel — xformers instead"; uv pip install -q -p "$T2" xformers==0.0.29.post2; export ATTN_BACKEND=xformers; }
mkdir -p /tmp/extensions
git clone -q -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /tmp/extensions/nvdiffrast
git clone -q -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git /tmp/extensions/nvdiffrec
git clone -q --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/extensions/CuMesh
git clone -q --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/extensions/FlexGEMM
cp -r "$W/TRELLIS.2/o-voxel" /tmp/extensions/o-voxel
for ext in nvdiffrast nvdiffrec CuMesh FlexGEMM o-voxel; do
  stamp "build $ext"
  uv pip install -q -p "$T2" --no-build-isolation "/tmp/extensions/$ext" || echo "!! $ext failed to build"
done
"$T2" -c "import torch, o_voxel, cumesh, flex_gemm, nvdiffrast.torch; print('trellis2 env ok', torch.__version__, torch.cuda.is_available())"

# ── A2. Stable Fast 3D: torch 2.4 из образа ──
stamp "SF3D environment"
git clone -q https://github.com/Stability-AI/stable-fast-3d.git "$W/stable-fast-3d" && git -C "$W/stable-fast-3d" checkout -q "$SF3D_COMMIT"
uv venv -q "$W/venv_sf3d" --python "$(command -v python3)" --system-site-packages
SF="$W/venv_sf3d/bin/python"
uv pip install -q -p "$SF" setuptools==69.5.1 wheel
(cd "$W/stable-fast-3d" && uv pip install -q -p "$SF" --no-build-isolation -r requirements.txt) || echo "!! SF3D requirements failed"
# зависимости SF3D тянут в окружение свежий torch (2.15, cu132) поверх 2.4 из образа, а его расширения собраны
# против другого — вернуть 2.4.1 и пересобрать их (сеанс 31.10: undefined symbol в uv_unwrapper)
uv pip install -q -p "$SF" torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu124
(cd "$W/stable-fast-3d" && uv pip install -q -p "$SF" --no-build-isolation --reinstall --no-deps ./texture_baker/ ./uv_unwrapper/)
"$SF" -c "import torch, uv_unwrapper, texture_baker; print('sf3d env ok', torch.__version__)"

# ── Blender для превью и картинки каталога ──
stamp "Blender"
curl -sSfL "https://download.blender.org/release/Blender5.0/$BLENDER.tar.xz" | tar xJ -C "$W"
BL="$W/$BLENDER/blender"

# ── A3. прогоны (после доступа к весам) ──
stamp "waiting for access to the gated weights (up to ${ACCESS_WAIT:-30} min)"
ACCESS=no
for i in $(seq $(( ${ACCESS_WAIT:-30} * 2 ))); do
  python "$POD/check_access.py" >/dev/null 2>&1 && { ACCESS=yes; break; }
  sleep 30
done
python "$POD/check_access.py"
if [ "$ACCESS" = yes ]; then
  stamp "TRELLIS.2 runs"
  "$T2" "$POD/run_trellis2.py" --repo "$W/TRELLIS.2" --photos "$PHOTOS" --out "$OUT/trellis2"
  stamp "SF3D runs"
  "$SF" "$POD/run_sf3d.py" --repo "$W/stable-fast-3d" --photos "$PHOTOS" --out "$OUT/sf3d"

  # ── B. превью и лист ──
  stamp "previews"
  for d in trellis2 sf3d; do "$BL" -b --factory-startup --python "$POD/render_previews.py" -- --glbs "$OUT/$d" --out "$OUT/previews" 2>&1 | grep -E "preview|Error"; done
  "$T2" "$POD/make_sheet.py" --session "$OUT" --out "$OUT/sheet.jpg"
else
  echo "!! no access to the gated weights — models skipped, Blender pictures only"
fi

# ── C. картинка каталога платья в клетку ──
stamp "catalogue picture of the gingham dress"
DZ=$(python3 -c "import json; m=json.load(open('client/public/models/demo-garments/manifest.json')); print(next(x['zOffsetM'] for x in m['items']['dress']['models'] if x['size']=='S'))")
mkdir -p "$OUT/catalogue"
"$BL" -b --factory-startup --python "$POD/render_catalogue.py" -- \
  --body research/patterns/runs/arms/bodies/zara_S.obj --garment client/public/models/demo-garments/dress_S.glb \
  --tile client/public/models/demo-garments/dress_print.png --tile-cm 4 --dz "$DZ" \
  --out "$OUT/catalogue/dress.png" --engine CYCLES --samples 256 2>&1 | grep -E "Cycles on|bbox|Error"

# ── D. виды сзади и сбоку шести демо-товаров (галерея на странице товара) ──
# тело размера S: платье, юбка, брюки, жакет, пальто — zara_S (86/66/94), футболка — uniqlo_S (86/68/94)
stamp "back and side pictures of the demo products"
mkdir -p "$OUT/gallery"
for item in dress skirt tee trousers jacket coat; do
  BODY=research/patterns/runs/arms/bodies/zara_S.obj
  [ "$item" = tee ] && BODY=research/patterns/runs/arms/bodies/uniqlo_S.obj
  DZ=$(python3 -c "import json; m=json.load(open('client/public/models/demo-garments/manifest.json')); print(next(x['zOffsetM'] for x in m['items']['$item']['models'] if x['size']=='S'))")
  TILE=(); [ "$item" = dress ] && TILE=(--tile client/public/models/demo-garments/dress_print.png --tile-cm 4)
  for view in back side; do
    "$BL" -b --factory-startup --python "$POD/render_catalogue.py" -- \
      --body "$BODY" --garment "client/public/models/demo-garments/${item}_S.glb" "${TILE[@]}" --dz "$DZ" \
      --view "$view" --out "$OUT/gallery/${item}_${view}.png" --engine CYCLES --samples 128 2>&1 | grep -E "bbox|Error"
  done
done

MIN=$(( ($(date +%s) - START) / 60 ))
stamp "done in $MIN min (≈ \$$(python3 -c "print(round($MIN / 60 * $PRICE, 2))") at \$$PRICE/h, without the time before this script and until Terminate)"
tar czf "$ROOT/research/accessories/runs/session1.tar.gz" -C "$ROOT/research/accessories/runs" session1
ls -la "$ROOT/research/accessories/runs/session1.tar.gz"
