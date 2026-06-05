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

MODEL_PATH = "/root/.cache/wan22-ti2v-5b"


def load_models():
    """Load Wan2.2-TI2V-5B in background thread.

    Uses enable_model_cpu_offload() so the full model fits on 24GB RTX 4090.
    VAE uses float32 for stability, pipeline uses bfloat16 for speed.
    """
    global pipe, model_loading, model_error, load_start_time
    try:
        model_loading = True
        load_start_time = time.time()

        from diffusers import WanPipeline, AutoencoderKLWan, UniPCMultistepScheduler

        # VAE in float32 for stability (Wan recommendation)
        print("[TACP] Loading Wan2.2-VAE...")
        vae = AutoencoderKLWan.from_pretrained(
            MODEL_PATH,
            subfolder="vae",
            torch_dtype=torch.float32,
            local_files_only=True,
        )

        # Main pipeline in bfloat16
        print("[TACP] Loading Wan2.2-TI2V-5B pipeline...")
        _pipe = WanPipeline.from_pretrained(
            MODEL_PATH,
            vae=vae,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )

        # flow_shift=3.0 for 480p, 5.0 for 720p
        _pipe.scheduler = UniPCMultistepScheduler.from_config(
            _pipe.scheduler.config,
            flow_shift=3.0,
        )

        # CPU offload — moves model components to CPU when not in use
        # This is what makes 24GB VRAM work for a 5B model
        _pipe.enable_model_cpu_offload()
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


# Start loading immediately — uvicorn serves /health while model loads
threading.Thread(target=load_models, daemon=True).start()


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
        "model": "Wan2.2-TI2V-5B",
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
    output_path = f"{OUTPUT_DIR}/{clip_id}.mp4"

    # Frame count: Wan needs num_frames for duration at 24fps
    # Use multiples of 4 + 1 for VAE compatibility
    num_frames = (req.duration * 24 // 4) * 4 + 1

    gen_start = time.time()

    try:
        print(f"[{clip_id[:8]}] Generating {req.width}x{req.height}, {num_frames} frames...")

        output = pipe(
            prompt=req.prompt,
            negative_prompt="low quality, blurry, distorted, watermark, text, subtitles, logo, deformed, extra limbs, oversaturated, cartoon, anime",
            height=req.height,
            width=req.width,
            num_frames=num_frames,
            num_inference_steps=40,
            guidance_scale=5.0,
            generator=torch.Generator(device="cpu").manual_seed(42),
            output_type="pil",
        )

        frames = output.frames[0]

        from diffusers.utils import export_to_video
        export_to_video(frames, output_path, fps=24)

        elapsed = int(time.time() - gen_start)
        print(f"[{clip_id[:8]}] Done in {elapsed}s — {output_path}")

    except Exception as e:
        gc.collect()
        torch.cuda.empty_cache()
        raise HTTPException(status_code=500, detail=str(e))

    gc.collect()
    torch.cuda.empty_cache()

    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail="Output file not created")

    return {"clip_id": clip_id, "path": output_path}


@app.get("/download/{clip_id}")
def download(clip_id: str):
    path = f"{OUTPUT_DIR}/{clip_id}.mp4"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(path, media_type="video/mp4", filename=f"{clip_id}.mp4")