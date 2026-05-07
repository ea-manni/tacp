#!/bin/bash
set -e

echo "=== TACP Startup ==="

# Install only what's missing from base pytorch image
pip install fastapi uvicorn diffusers transformers accelerate sentencepiece --quiet

# Pre-download model weights to disk cache
echo "Downloading LTX-Video weights (~4GB)..."
python3 -c "
from diffusers import LTXPipeline
import torch
pipe = LTXPipeline.from_pretrained(
    'Lightricks/LTX-Video',
    torch_dtype=torch.bfloat16
)
print('Weights cached.')
"

echo "Starting TACP server..."
cd /workspace
uvicorn tacp_server:app --host 0.0.0.0 --port 8080 &

echo "=== Ready ==="