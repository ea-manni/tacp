import os, gc, uuid, torch, threading, time
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()
OUTPUT_DIR = "/workspace/outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Global state ──────────────────────────────────────────────────────────────
pipe = None
model_loading = False
model_error = None
load_start_time = None

MODEL_PATH = os.getenv("MODEL_DIR", "/workspace/ltx-video")

# ── Job store ─────────────────────────────────────────────────────────────────
jobs: dict = {}
jobs_lock = threading.Lock()


def load_models():
    global pipe, model_loading, model_error, load_start_time
    try:
        model_loading = True
        load_start_time = time.time()

        from diffusers import LTXPipeline
        from transformers import T5EncoderModel

        print("[TACP] Loading LTX-Video 2B distilled FP8...")

        # FP8 single file doesn't include text encoder — load separately
        print("[TACP] Loading T5 text encoder...")
        text_encoder = T5EncoderModel.from_pretrained(
            MODEL_PATH,
            subfolder="text_encoder",
            torch_dtype=torch.bfloat16,
        )

        print("[TACP] Loading pipeline from FP8 checkpoint...")
        _pipe = LTXPipeline.from_single_file(
            os.path.join(MODEL_PATH, "ltxv-2b-0.9.8-distilled-fp8.safetensors"),
            text_encoder=text_encoder,
            torch_dtype=torch.bfloat16,
        )
        _pipe.to("cuda")
        _pipe.vae.enable_tiling()

        pipe = _pipe

        elapsed = int(time.time() - load_start_time)
        print(f"[TACP] Pipeline ready in {elapsed}s")

    except Exception as e:
        model_error = str(e)
        import traceback
        traceback.print_exc()
        print(f"[TACP] Model load FAILED: {e}")
    finally:
        model_loading = False


threading.Thread(target=load_models, daemon=True).start()


# ── Job worker ────────────────────────────────────────────────────────────────
def run_generation(clip_id: str, prompt: str, width: int, height: int, duration: int):
    output_path = f"{OUTPUT_DIR}/{clip_id}.mp4"

    # Frames: divisible by 8 + 1, at 24fps
    num_frames = (duration * 24 // 8) * 8 + 1

    # Resolution must be divisible by 32
    height = (height // 32) * 32
    width = (width // 32) * 32

    with jobs_lock:
        jobs[clip_id]["status"] = "running"
        jobs[clip_id]["started_at"] = time.time()

    try:
        print(f"[{clip_id[:8]}] Generating {width}x{height}, {num_frames} frames...")

        output = pipe(
            prompt=prompt,
            negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text, logo",
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=8,     # distilled — 4-8 steps is enough
            guidance_scale=1.0,        # distilled — must be 1.0
            generator=torch.Generator(device="cuda").manual_seed(42),
        )

        frames = output.frames[0]

        from diffusers.utils import export_to_video
        export_to_video(frames, output_path, fps=24)

        elapsed = int(time.time() - jobs[clip_id]["started_at"])
        print(f"[{clip_id[:8]}] Done in {elapsed}s")

        with jobs_lock:
            jobs[clip_id]["status"] = "done"
            jobs[clip_id]["path"] = output_path
            jobs[clip_id]["elapsed"] = elapsed

    except Exception as e:
        print(f"[{clip_id[:8]}] FAILED: {e}")
        with jobs_lock:
            jobs[clip_id]["status"] = "error"
            jobs[clip_id]["error"] = str(e)
    finally:
        gc.collect()
        torch.cuda.empty_cache()


# ── Request schema ────────────────────────────────────────────────────────────
class ClipRequest(BaseModel):
    prompt: str
    duration: int = 5
    width: int = 480
    height: int = 832


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    loading_elapsed = None
    if load_start_time and model_loading:
        loading_elapsed = int(time.time() - load_start_time)

    return {
        "status": "ok",
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1),
        "model": "LTX-Video-2B-distilled-fp8",
        "model_loaded": pipe is not None,
        "model_loading": model_loading,
        "model_error": model_error,
        "loading_elapsed_sec": loading_elapsed,
    }


@app.post("/generate")
def generate(req: ClipRequest):
    if model_error:
        raise HTTPException(status_code=500, detail=f"Model failed to load: {model_error}")
    if pipe is None:
        raise HTTPException(status_code=503, detail="Model still loading — try again in a moment")

    clip_id = str(uuid.uuid4())

    with jobs_lock:
        jobs[clip_id] = {
            "status": "queued",
            "path": None,
            "error": None,
            "started_at": None,
            "elapsed": None,
        }

    threading.Thread(
        target=run_generation,
        args=(clip_id, req.prompt, req.width, req.height, req.duration),
        daemon=True,
    ).start()

    print(f"[{clip_id[:8]}] Job queued")
    return {"clip_id": clip_id, "status": "queued"}


@app.get("/status/{clip_id}")
def status(clip_id: str):
    with jobs_lock:
        job = jobs.get(clip_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    elapsed = None
    if job["started_at"]:
        elapsed = int(time.time() - job["started_at"])

    return {
        "clip_id": clip_id,
        "status": job["status"],
        "elapsed_sec": elapsed,
        "error": job["error"],
    }


@app.get("/download/{clip_id}")
def download(clip_id: str):
    with jobs_lock:
        job = jobs.get(clip_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=400, detail=f"Job not ready — status: {job['status']}")
    if not os.path.exists(job["path"]):
        raise HTTPException(status_code=500, detail="Output file missing")

    return FileResponse(job["path"], media_type="video/mp4", filename=f"{clip_id}.mp4")