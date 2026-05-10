import os, gc, uuid, torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()
OUTPUT_DIR = "/workspace/outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Loading LTX-Video 0.9.7-dev pipeline (13B, single-stage, no upscaler)...")

from diffusers import LTXConditionPipeline

pipe = LTXConditionPipeline.from_pretrained(
    "/root/.cache/ltx-video-0.9.7-dev",
    torch_dtype=torch.bfloat16,
    local_files_only=True,
)
pipe.to("cuda")
pipe.vae.enable_tiling()  # essential for 13B model VRAM headroom
print(f"Pipeline ready on {torch.cuda.get_device_name(0)}")


class ClipRequest(BaseModel):
    prompt: str
    duration: int = 6
    width: int = 480
    height: int = 832


def round_to_vae_acceptable(height: int, width: int) -> tuple[int, int]:
    """LTX requires dimensions divisible by the VAE spatial compression ratio."""
    ratio = pipe.vae_spatial_compression_ratio
    height = height - (height % ratio)
    width = width - (width % ratio)
    return height, width


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1),
        "model": "LTX-Video-0.9.7-dev",
        "stages": "single-stage (no upscaler)",
    }


@app.post("/generate")
def generate(req: ClipRequest):
    clip_id = str(uuid.uuid4())
    output_path = f"{OUTPUT_DIR}/{clip_id}.mp4"

    # Frame count must be divisible by 8 + 1
    num_frames = req.duration * 24 + 1

    # Snap dims to VAE-acceptable values
    height, width = round_to_vae_acceptable(req.height, req.width)

    try:
        output = pipe(
            conditions=None,
            prompt=req.prompt,
            negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted",
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=30,
            decode_timestep=0.05,
            image_cond_noise_scale=0.025,
            generator=torch.Generator(device="cuda").manual_seed(42),
            output_type="pil",
        )

        from diffusers.utils import export_to_video
        export_to_video(output.frames[0], output_path, fps=24)

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