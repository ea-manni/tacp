FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV MODEL_DIR=/workspace/ltx-video

RUN apt-get update && apt-get install -y git ffmpeg && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn==0.30.0 \
    transformers==4.52.0 \
    tokenizers==0.21.4 \
    accelerate==1.0.1 \
    sentencepiece==0.2.0 \
    imageio==2.34.2 \
    imageio-ffmpeg==0.5.1 \
    ftfy==6.2.0 \
    "huggingface_hub[cli]==0.34.4" \
    git+https://github.com/huggingface/diffusers@62ec337e30cde4cfc41da0454d9c98d87cdb75f0

# Copy server files to /app — NOT /workspace (volume disk mounts there and wipes it)
RUN mkdir -p /app
COPY src/runpod/server.py /app/tacp_server.py
COPY src/runpod/hydrate_model.py /app/hydrate_model.py
COPY src/runpod/entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

WORKDIR /workspace

EXPOSE 8080

CMD ["/app/entrypoint.sh"]