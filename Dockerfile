FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=300
ENV HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

# Install latest diffusers from git for LTX 0.9.7 support, plus runtime deps
# Note: diffusers main requires huggingface_hub>=0.34, transformers>=4.45
RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    transformers==4.46.3 \
    accelerate==1.0.1 \
    sentencepiece==0.2.0 \
    imageio==2.34.2 \
    imageio-ffmpeg==0.5.1 \
    ftfy==6.2.0 \
    "huggingface_hub[cli,hf_transfer]==0.34.4" \
    git+https://github.com/huggingface/diffusers@main

# Pre-download LTX-Video 0.9.7-dev (13B) — base model only, no upscaler
# Each component in its own RUN layer so Docker caches granularly
RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev model_index.json \
    --local-dir /root/.cache/ltx-video-0.9.7-dev

RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev \
    --local-dir /root/.cache/ltx-video-0.9.7-dev \
    --include "scheduler/*"

RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev \
    --local-dir /root/.cache/ltx-video-0.9.7-dev \
    --include "tokenizer/*"

RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev \
    --local-dir /root/.cache/ltx-video-0.9.7-dev \
    --include "text_encoder/*"

RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev \
    --local-dir /root/.cache/ltx-video-0.9.7-dev \
    --include "vae/*"

# Transformer is sharded — must include all .safetensors and the index json
RUN huggingface-cli download Lightricks/LTX-Video-0.9.7-dev \
    --local-dir /root/.cache/ltx-video-0.9.7-dev \
    --include "transformer/*"

WORKDIR /workspace
COPY src/vastai/server.py /workspace/tacp_server.py

EXPOSE 8080
CMD ["uvicorn", "tacp_server:app", "--host", "0.0.0.0", "--port", "8080", "--app-dir", "/workspace"]