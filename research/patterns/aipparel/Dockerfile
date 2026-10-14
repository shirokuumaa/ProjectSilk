# AIpparel inference image — PREPARED, NOT BUILT (decision of 2026-10-13: build only if the
# timings from the first GPU session show it pays off).
#
# Public-image rule: only openly licensed components. Inside: AIpparel code (MIT, pinned commit),
# Python deps (BSD/MIT/Apache/LGPL), uv (MIT/Apache). NOT inside: any weights. At start the
# container downloads AIpparel (MIT), LLaVA-1.5-7B (Llama 2 Community License) and CLIP (MIT)
# from Hugging Face into /cache (mount a disk there to keep them). Nothing from ChatGarment.
#
# Build (context = research/patterns):
#   docker buildx build --platform linux/amd64 -f aipparel/Dockerfile -t shirokuuma/aipparel:<tag> .
# Run: docker run --gpus all -v <disk>:/cache -v <inputs>:/data shirokuuma/aipparel:<tag> \
#        --manifest /data/manifest.json --out /data/out
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_LINK_MODE=copy \
    HF_HOME=/cache/hf \
    HF_XET_HIGH_PERFORMANCE=1

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git libcairo2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv

# Same install script as on the RunPod pod.
COPY pod/versions.sh /opt/patterns/pod/versions.sh
COPY aipparel/install.sh /opt/patterns/aipparel/install.sh
RUN bash /opt/patterns/aipparel/install.sh /opt/aipparel && rm -rf /root/.cache

# Separate small venv for downloads: AIpparel pins huggingface_hub 0.23 (no Xet = slow downloads).
RUN uv venv -q -p 3.10 /opt/venv-tools \
    && uv pip install -q -p /opt/venv-tools/bin/python "huggingface_hub[hf_xet]==2.2.0"
COPY pod/fetch_weights.py aipparel/run_aipparel.py aipparel/entrypoint.sh /opt/patterns/aipparel/

ENTRYPOINT ["bash", "/opt/patterns/aipparel/entrypoint.sh"]
