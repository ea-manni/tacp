#!/bin/bash
# ── TACP: One-time Wan2.2-TI2V-5B volume download ────────────────────────────
# Run this ONCE on a Vast.ai instance with your volume mounted.
# After this completes, the model lives on the volume permanently.
#
# Recommended instance for this: any cheap CPU-only instance (~$0.005/hr)
# with your volume attached. No GPU needed for download.
#
# Usage:
#   bash download_model.sh

set -e

MODEL_DIR="/root/.cache/wan22-ti2v-5b"

echo "[TACP] Checking volume mount..."
if [ ! -d "$(dirname $MODEL_DIR)" ]; then
  echo "ERROR: /root/.cache does not exist. Is your volume mounted correctly?"
  exit 1
fi

if [ -f "$MODEL_DIR/model_index.json" ]; then
  echo "[TACP] Model already exists at $MODEL_DIR — skipping download."
  exit 0
fi

echo "[TACP] Starting download of Wan2.2-TI2V-5B-Diffusers (~34GB)..."
echo "[TACP] This will take 20-40 minutes depending on connection speed."

pip install -q "huggingface_hub[cli,hf_transfer]"

HF_HUB_ENABLE_HF_TRANSFER=1 huggingface-cli download \
    Wan-AI/Wan2.2-TI2V-5B-Diffusers \
    --local-dir "$MODEL_DIR"

echo "[TACP] Download complete. Model is at $MODEL_DIR"
echo "[TACP] You can now detach this volume and attach it to any GPU instance."
