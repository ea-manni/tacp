FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=300

RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install packages without pinning conflicting versions
RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    diffusers==0.30.3 \
    transformers==4.41.2 \
    accelerate==0.30.0 \
    sentencepiece==0.2.0 \
    huggingface_hub==0.23.2

# Pre-download LTX-Video model weights
RUN pip install --no-cache-dir "huggingface_hub[cli]" && \
    huggingface-cli download Lightricks/LTX-Video \
        --local-dir /root/.cache/ltx-video \
        --local-dir-use-symlinks False \
        --include "ltx-video-2b-v0.9.5.safetensors" \
        --include "*.json" \
        --include "*.txt" \
        --include "tokenizer/*" \
        --include "scheduler/*" \
        --include "text_encoder/*" \
        --include "vae/*" \
        --include "transformer/*" \
    && echo "LTX-Video weights downloaded."

WORKDIR /workspace
COPY src/vastai/server.py /workspace/tacp_server.py

EXPOSE 8080

CMD ["uvicorn", "tacp_server:app", "--host", "0.0.0.0", "--port", "8080"]