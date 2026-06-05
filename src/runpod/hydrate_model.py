#!/usr/bin/env python3
"""
TACP Model Hydration Script — LTX-Video 2B distilled FP8
Downloads only the single safetensors file (4.46GB) from Lightricks/LTX-Video.
"""

import os, sys, time, shutil

# Force ALL HuggingFace cache to volume disk — prevents container disk from filling up
os.environ["HF_HOME"] = "/workspace/.hf_cache"
os.environ["HUGGINGFACE_HUB_CACHE"] = "/workspace/.hf_cache"

MODEL_DIR = os.getenv("MODEL_DIR", "/workspace/ltx-video")
PARTIAL_DIR = "/workspace/ltx-video.partial"  # always on volume disk
READY_FILE = os.path.join(MODEL_DIR, ".tacp_model_ready")

HF_REPO = "Lightricks/LTX-Video"
MODEL_FILE = "ltxv-2b-0.9.8-distilled-fp8.safetensors"


def model_is_ready():
    if not os.path.exists(READY_FILE):
        return False
    if not os.path.exists(os.path.join(MODEL_DIR, MODEL_FILE)):
        print(f"   ⚠️  Missing model file: {MODEL_FILE}")
        return False
    return True


def cleanup_partial():
    if os.path.exists(PARTIAL_DIR):
        print(f"   🧹 Removing partial download...")
        shutil.rmtree(PARTIAL_DIR, ignore_errors=True)


def download():
    print(f"   📥 Downloading {HF_REPO} from Hugging Face...")
    print(f"   📦 Grabbing text encoder, VAE, scheduler + FP8 weights (~6GB total)...")

    try:
        from huggingface_hub import snapshot_download

        cleanup_partial()
        os.makedirs(PARTIAL_DIR, exist_ok=True)

        start = time.time()
        snapshot_download(
            repo_id=HF_REPO,
            local_dir=PARTIAL_DIR,
            local_dir_use_symlinks=False,
            ignore_patterns=[
                "*.md", "*.gitattributes",
                "ltxv-13b*",                              # skip 13B weights
                "ltxv-2b-0.9.6*",                        # skip older versions
                "ltxv-2b-0.9.8-distilled.safetensors",   # skip non-FP8 version
            ],
        )
        elapsed = int(time.time() - start)
        print(f"   ✅ Downloaded in {elapsed}s")

        # Verify FP8 weights file exists
        fp8_path = os.path.join(PARTIAL_DIR, MODEL_FILE)
        if not os.path.exists(fp8_path):
            raise RuntimeError(f"FP8 weights file missing after download: {MODEL_FILE}")

        size = os.path.getsize(fp8_path)
        if size < 4_000_000_000:
            raise RuntimeError(f"FP8 weights file too small: {size} bytes")

        # Atomic move
        if os.path.exists(MODEL_DIR):
            shutil.rmtree(MODEL_DIR)
        shutil.move(PARTIAL_DIR, MODEL_DIR)
        print(f"   ✅ Model moved to {MODEL_DIR}")

    except Exception as e:
        cleanup_partial()
        raise RuntimeError(f"Download failed: {e}")


def mark_ready():
    with open(READY_FILE, "w") as f:
        f.write("ready\n")
    print(f"   ✅ Marked ready")


def main():
    print("\n" + "=" * 50)
    print("🎬 TACP Model Hydration — LTX-Video 2B FP8")
    print("=" * 50)
    print(f"   Model dir: {MODEL_DIR}")
    print(f"   Repo:      {HF_REPO}")   

    if model_is_ready():
        print("   ✅ Model already present — skipping download")
        print("=" * 50 + "\n")
        return

    print("   ⬇️  Model not found — starting hydration...")

    if os.path.exists(MODEL_DIR) and not os.path.exists(READY_FILE):
        print(f"   🧹 Removing incomplete model dir...")
        shutil.rmtree(MODEL_DIR, ignore_errors=True)

    download()
    mark_ready()

    print("\n   🎉 Hydration complete!")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Hydration failed: {e}")
        sys.exit(1)