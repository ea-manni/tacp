from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import torch
import uuid
import os

app = FastAPI()
OUTPUT_DIR = "/tmp/clips"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Load pipeline once at startup — already cached from Docker build
print("Loading LTX-Video pipeline from cache...")
from diffusers import LTXPipeline

pipe = LTXPipeline.from_pretrained(
    "/root/.cache/ltx-video",
    torch_dtype=torch.bfloat16,
    local_files_only=True,
)

pipe.to("cuda")
print(f"✅ Pipeline ready on {torch.cuda.get_device_name(0)}")

class ClipRequest(BaseModel):
    prompt: str
    duration: int = 5
    width: int = 480
    height: int = 832

@app.get("/health")
def health():
    return {
        "status": "ok",
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
    }

@app.post("/generate")
def generate(req: ClipRequest):
    clip_id = str(uuid.uuid4())
    output_path = f"{OUTPUT_DIR}/{clip_id}.mp4"
    num_frames = req.duration * 24 + 1

    try:
        output = pipe(
            prompt=req.prompt,
            negative_prompt="blur, distortion, watermark, text, logo, low quality, flickering",
            width=req.width,
            height=req.height,
            num_frames=num_frames,
            num_inference_steps=30,
            guidance_scale=3.0,
        )
        from diffusers.utils import export_to_video
        export_to_video(output.frames[0], output_path, fps=24)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail="Output file not created")

    torch.cuda.empty_cache()
    return {"clip_id": clip_id, "path": output_path}

@app.get("/download/{clip_id}")
def download(clip_id: str):
    path = f"{OUTPUT_DIR}/{clip_id}.mp4"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(path, media_type="video/mp4", filename=f"{clip_id}.mp4")