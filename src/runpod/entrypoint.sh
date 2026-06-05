#!/usr/bin/env bash
set -e

echo ""
echo "=================================================="
echo "🚀 TACP GPU Server Starting"
echo "=================================================="

MODEL_DIR="${MODEL_DIR:-/workspace/ltx-video}"
export MODEL_DIR

echo "   Provider:  ${PROVIDER:-unknown}"
echo "   Model dir: $MODEL_DIR"
echo ""

echo "▶ Step 1/2: Model hydration..."
python /app/hydrate_model.py

if [ $? -ne 0 ]; then
  echo "❌ Model hydration failed — aborting"
  exit 1
fi

echo "▶ Step 2/2: Starting FastAPI server on port 8080..."
exec uvicorn tacp_server:app --host 0.0.0.0 --port 8080 --app-dir /app