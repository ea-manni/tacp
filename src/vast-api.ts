import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { renderVideo } from "./remotion/render.js";
import { uploadToR2 } from "./r2/upload.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.raw({ type: "application/json", limit: "500mb" }));

const PORT = process.env.PORT || 3002;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/render", async (req, res) => {
  let body;
  try {
    body = typeof req.body === "string" || Buffer.isBuffer(req.body) 
      ? JSON.parse(req.body.toString()) 
      : req.body;
  } catch (e) {
    console.error("Body parse failed");
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { jobId, storyId, pkg, audioBase64 } = body;
  if (!jobId || !storyId || !pkg || !audioBase64) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log(`[${jobId}] Render request received on Vast.ai`);

  try {
    // 1. Save audio
    const audioDir = path.join("output", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${storyId}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));
    console.log(`[${jobId}] Audio saved`);

    // 2. WhisperX alignment
    console.log(`[${jobId}] Running WhisperX...`);
    const alignmentResult = runWhisperX(audioPath, pkg);

    // 3. Remotion render (stills will be handled inside renderVideo if needed)
    console.log(`[${jobId}] Starting Remotion render...`);
    const videoPath = await renderVideo(
      pkg,
      storyId,
      audioPath,
      alignmentResult.totalDuration,
      alignmentResult.segmentDurations
    );

    // 4. Upload to B2
    console.log(`[${jobId}] Uploading to B2...`);
    const outputUrl = await uploadToR2(videoPath, `videos/${jobId}.mp4`);

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch {}
    try { fs.unlinkSync(videoPath); } catch {}

    console.log(`[${jobId}] ✅ Render complete: ${outputUrl}`);
    return res.json({ outputUrl });

  } catch (err: any) {
    console.error(`[${jobId}] Render failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

function runWhisperX(audioPath: string, pkg: any) {
  const whisperPython = process.env.WHISPERX_PYTHON ?? "python3";
  const script = `
import whisperx, json, sys
audio_path = sys.argv[1]
segments_path = sys.argv[2]
with open(segments_path) as f: segments = json.load(f)
device = "cuda"
model = whisperx.load_model("base", device, compute_type="float16")
audio = whisperx.load_audio(audio_path)
result = model.transcribe(audio)
align_model, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)

words = []
for seg in result["segments"]:
  for w in seg.get("words", []):
    words.append({"word": w["word"].strip().lower(), "start": w.get("start",0), "end": w.get("end",0)})

segment_durations = []
word_idx = 0
prev_end = 0.0
for seg in segments:
  seg_words = seg.get("narration_text","").lower().split()
  seg_word_count = len(seg_words)
  end_idx = min(word_idx + seg_word_count, len(words)-1)
  seg_end = words[end_idx]["end"] if end_idx < len(words) and words[end_idx].get("end",0) > 0 else prev_end + 5
  duration = seg_end - prev_end
  segment_durations.append(max(duration, 1.0))
  prev_end = seg_end
  word_idx += seg_word_count

total = sum(segment_durations)
print(json.dumps({"segment_durations": segment_durations, "total_duration": total}))
  `;

  const outDir = path.join("output");
  fs.mkdirSync(outDir, { recursive: true });
  const scriptPath = path.join(outDir, "align.py");
  const segmentsPath = path.join(outDir, "segments.json");

  fs.writeFileSync(scriptPath, script);
  fs.writeFileSync(segmentsPath, JSON.stringify(pkg.segments || []));

  const resultStr = execSync(
    `${whisperPython} "${scriptPath}" "${audioPath}" "${segmentsPath}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  ).toString().trim();

  return JSON.parse(resultStr);
}

app.listen(PORT, () => {
  console.log(`Vast.ai Render API running on port ${PORT}`);
});