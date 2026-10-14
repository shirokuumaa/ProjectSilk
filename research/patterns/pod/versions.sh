# Pinned versions for the pattern prototype. Sourced by install scripts (pod, Docker, Mac).

UV_VERSION=0.13.0
PYTHON_VERSION=3.10

# Repos (commit, date)
AIPPAREL_REPO=https://github.com/georgeNakayama/AIpparel-Code.git
AIPPAREL_COMMIT=c08e08923c638fd0cf9721d1e937cf5d2ac86933        # 2025-07-06, MIT
CHATGARMENT_REPO=https://github.com/biansy000/ChatGarment.git
CHATGARMENT_COMMIT=798c34ac04319668aaa0e3a3a02d44284fbd70ec     # 2025-08-07, Apache-2.0 (weights: no license)
GARMENTCODERC_REPO=https://github.com/biansy000/GarmentCodeRC.git
GARMENTCODERC_COMMIT=e3d4476d6f9bcb0af5ee0eccd18b0433e3df398a   # 2025-04-28, MIT
GARMENTCODE_REPO=https://github.com/maria-korosteleva/GarmentCode.git
GARMENTCODE_COMMIT=d449629979028123a5c4dc9e732a2ec19b7fce31     # 2025-06-29, MIT

# Torch builds (CUDA 12.1 wheels carry their own CUDA libs; only the driver comes from the host)
TORCH_INDEX=https://download.pytorch.org/whl/cu121
AIPPAREL_TORCH="torch==2.3.1 torchvision==0.18.1"
CHATGARMENT_TORCH="torch==2.1.2 torchvision==0.16.2"
