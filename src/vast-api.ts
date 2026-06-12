// Vast.ai Render + Alignment API
// POST /render   -> receives pkg + audioBase64, runs WhisperX + Remotion, uploads to B2
// GET  /health   -> health check
// WhisperX logic lives in scripts/align.py (committed to repo, baked into Docker image)

import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { renderVideo } from "./remotion/render.js";
import { uploadToR2 } from "./r2/upload.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json({ limit: "500mb" }));

const PORT = process.env.PORT || 3002;
const ALIGN_SCRIPT = path.resolve("scripts", "align.py");

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
    console.log(`[${jobId}] Audio written: ${audioPath} (${fs.statSync(audioPath).size} bytes)`);

    // Run WhisperX alignment via external script
    console.log(`[${jobId}] Running WhisperX alignment...`);
    const alignmentResult = runWhisperX(audioPath, pkg);
    console.log(`[${jobId}] Alignment complete: ${alignmentResult.segmentDurations.map((d) => d.toFixed(2)).join(", ")}`);

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

function runWhisperX(
  audioPath: string,
  pkg: any
): { segmentDurations: number[]; totalDuration: number } {
  const whisperPython = process.env.WHISPERX_PYTHON ?? "python3";

  if (!fs.existsSync(ALIGN_SCRIPT)) {
    throw new Error(`Alignment script not found at ${ALIGN_SCRIPT}`);
  }

  const segmentsPath = path.join("output", "segments.json");
  fs.writeFileSync(segmentsPath, JSON.stringify(pkg.segments));

  // execFileSync: no shell involved, no escaping issues, args passed directly
  const stdout = execFileSync(
    whisperPython,
    [ALIGN_SCRIPT, audioPath, segmentsPath],
    { maxBuffer: 10 * 1024 * 1024 }
  ).toString().trim();

  // The script prints exactly one JSON line at the end; warnings go to stderr
  const lastLine = stdout.split("\n").filter(Boolean).pop() ?? "";
  const parsed = JSON.parse(lastLine);

  return {
    segmentDurations: parsed.segment_durations,
    totalDuration: parsed.total_duration,
  };
}

app.listen(PORT, () => {
  console.log(`Vast.ai Render API running on port ${PORT}`);
});

export default app;