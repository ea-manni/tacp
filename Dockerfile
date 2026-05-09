FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=300
ENV HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    diffusers==0.32.2 \
    transformers==4.44.2 \
    accelerate==0.33.0 \
    sentencepiece==0.2.0 \
    imageio==2.34.2 \
    imageio-ffmpeg==0.5.1 \
    "huggingface_hub[cli,hf_transfer]==0.24.5"

# Pipeline config files (small, fast)
RUN huggingface-cli download Lightricks/LTX-Video model_index.json \
    --local-dir /root/.cache/ltx-video

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "scheduler/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "tokenizer/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "transformer/*.json"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "vae/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "text_encoder/*"

# FP8 distilled transformer (~4.5GB) — the only weight file we actually load
RUN huggingface-cli download Lightricks/LTX-Video \
    ltxv-2b-0.9.8-distilled-fp8.safetensors \
    --local-dir /root/.cache/ltx-video

WORKDIR /workspace
COPY src/vastai/server.py /workspace/tacp_server.py

EXPOSE 8080
CMD ["uvicorn", "tacp_server:app", "--host", "0.0.0.0", "--port", "8080", "--app-dir", "/workspace"]