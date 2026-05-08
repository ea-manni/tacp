FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DEFAULT_TIMEOUT=300

RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    diffusers==0.32.2 \
    transformers==4.41.2 \
    accelerate==0.30.0 \
    sentencepiece==0.2.0 \
    "huggingface_hub[cli]==0.23.2"

# Download model files one by one to avoid timeout
RUN huggingface-cli download Lightricks/LTX-Video model_index.json \
    --local-dir /root/.cache/ltx-video

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "scheduler/*" \
    --include "tokenizer/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "vae/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "transformer/*"

RUN huggingface-cli download Lightricks/LTX-Video \
    ltx-video-2b-v0.9.5.safetensors \
    --local-dir /root/.cache/ltx-video

RUN huggingface-cli download Lightricks/LTX-Video \
    --local-dir /root/.cache/ltx-video \
    --include "text_encoder/*"

WORKDIR /workspace
COPY src/vastai/server.py /workspace/tacp_server.py
EXPOSE 8080
CMD ["uvicorn", "tacp_server:app", "--host", "0.0.0.0", "--port", "8080"]