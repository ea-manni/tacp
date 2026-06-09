// Vast.ai Render + Alignment API
// POST /render   → receives pkg + audio + stills, runs WhisperX + Remotion, uploads to B2
// GET  /health   → health check

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

const PORT = process.env.PORT || 3002;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/render", async (req, res) => {
  const { jobId, storyId, pkg, audioBase64, segmentImages } = req.body;

  if (!jobId || !storyId || !pkg || !audioBase64) {
    return res.status(400).json({ error: "jobId, storyId, pkg, audioBase64 required" });
  }

  console.log(`[${jobId}] Render request received`);

  try {
    // Write audio to disk
    const audioDir = path.join("output", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${storyId}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));
    console.log(`[${jobId}] Audio written to ${audioPath}`);

    // Run WhisperX alignment
    console.log(`[${jobId}] Running WhisperX alignment...`);
    const alignmentResult = runWhisperX(audioPath, pkg);
    console.log(`[${jobId}] Alignment complete`);

    // Render video
    console.log(`[${jobId}] Starting Remotion render...`);
    const videoPath = await renderVideo(
      pkg,
      storyId,
      audioPath,
      alignmentResult.totalDuration,
      alignmentResult.segmentDurations,
      segmentImages ?? {}
    );
    console.log(`[${jobId}] Render complete: ${videoPath}`);

    // Upload to B2
    console.log(`[${jobId}] Uploading to B2...`);
    const outputUrl = await uploadToR2(videoPath, `videos/${jobId}.mp4`);
    console.log(`[${jobId}] Uploaded: ${outputUrl}`);

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch {}
    try { fs.unlinkSync(videoPath); } catch {}

    return res.json({ outputUrl });
  } catch (err: any) {
    console.error(`[${jobId}] Render failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

function runWhisperX(audioPath: string, pkg: any): { segmentDurations: number[]; totalDuration: number } {
  const whisperPython = process.env.WHISPERX_PYTHON ?? "python3";

  const script = `
import whisperx
import json
import sys

audio_path = sys.argv[1]
segments_json = sys.argv[2]
segments = json.loads(segments_json)

device = "cuda"
model = whisperx.load_model("base", device, compute_type="float16")
audio = whisperx.load_audio(audio_path)
result = model.transcribe(audio)

align_model, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)

# Match whisperx word timestamps to script segments
words = []
for seg in result["segments"]:
    for w in seg.get("words", []):
        words.append({"word": w["word"].strip().lower(), "start": w.get("start", 0), "end": w.get("end", 0)})

# Find segment boundaries by matching narration text to words
segment_durations = []
word_idx = 0
prev_end = 0.0

for seg in segments:
    seg_words = seg["narration_text"].lower().split()
    seg_word_count = len(seg_words)
    end_idx = min(word_idx + seg_word_count, len(words) - 1)
    if end_idx < len(words):
        seg_end = words[end_idx]["end"] if words[end_idx]["end"] > 0 else prev_end + 5.0
    else:
        seg_end = words[-1]["end"] if words else prev_end + 5.0
    duration = seg_end - prev_end
    segment_durations.append(max(duration, 1.0))
    prev_end = seg_end
    word_idx += seg_word_count

total = sum(segment_durations)
print(json.dumps({"segment_durations": segment_durations, "total_duration": total}))
`;

  const scriptPath = path.join("output", "align.py");
  fs.writeFileSync(scriptPath, script);

  const segmentsJson = JSON.stringify(pkg.segments).replace(/'/g, "\\'");
  const result = execSync(
    `${whisperPython} ${scriptPath} "${audioPath}" '${segmentsJson}'`,
    { maxBuffer: 10 * 1024 * 1024 }
  ).toString().trim();

  const parsed = JSON.parse(result);
  return {
    segmentDurations: parsed.segment_durations,
    totalDuration: parsed.total_duration,
  };
}

app.listen(PORT, () => {
  console.log(`Vast.ai Render API running on port ${PORT}`);
});

export default app;