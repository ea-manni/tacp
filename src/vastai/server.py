import os, gc, uuid, torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()
OUTPUT_DIR = "/workspace/outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("Loading LTX-Video fp8 pipeline...")
from diffusers import LTXPipeline, LTXVideoTransformer3DModel

transformer = LTXVideoTransformer3DModel.from_single_file(
    "/root/.cache/ltx-video/ltxv-2b-0.9.8-distilled-fp8.safetensors",
    torch_dtype=torch.bfloat16,
)
pipe = LTXPipeline.from_pretrained(
    "/root/.cache/ltx-video",
    transformer=transformer,
    torch_dtype=torch.bfloat16,
    local_files_only=True,
)
pipe.to("cuda")
print(f"Pipeline ready on {torch.cuda.get_device_name(0)}")

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
            negative_prompt="blur, distortion, watermark, text, logo, low quality",
            width=req.width,
            height=req.height,
            num_frames=num_frames,
            num_inference_steps=8,
            guidance_scale=1.0,
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