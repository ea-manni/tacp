// Contabo CPU Render API
// POST /render   -> fetches audio+stills from B2 URLs, runs WhisperX (CPU) + Remotion, uploads video to B2
// GET  /health   -> health check

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
app.use(express.json({ limit: "10mb" })); // URLs only — no base64 blobs

const PORT = process.env.PORT || 3002;
const ALIGN_SCRIPT = path.resolve("scripts", "align.py");
const WHISPER_PYTHON = process.env.WHISPERX_PYTHON ?? "python3";

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/render", async (req, res) => {
  const { jobId, storyId, pkg, audioUrl, segmentImageUrls, aspectRatio, isWatermarked } = req.body;

  if (!jobId || !storyId || !pkg || !audioUrl) {
    return res.status(400).json({ error: "jobId, storyId, pkg, audioUrl required" });
  }

  console.log(`[${jobId}] Render request received`);

  try {
    // Fetch audio from B2
    console.log(`[${jobId}] Fetching audio from B2...`);
    const audioDir = path.join("output", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${storyId}.wav`);

    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to fetch audio: ${audioRes.status}`);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    fs.writeFileSync(audioPath, audioBuffer);
    console.log(`[${jobId}] Audio written: ${audioPath} (${audioBuffer.length} bytes)`);

    // Fetch stills from B2
    console.log(`[${jobId}] Fetching stills from B2...`);
    const stillsDir = path.join("output", "stills", storyId);
    fs.mkdirSync(stillsDir, { recursive: true });
    const segmentImages: Record<number, string> = {};

    await Promise.all(
      Object.entries(segmentImageUrls ?? {}).map(async ([indexStr, url]) => {
        const index = Number(indexStr);
        const stillRes = await fetch(url as string);
        if (!stillRes.ok) throw new Error(`Failed to fetch still ${index}: ${stillRes.status}`);
        const stillBuffer = Buffer.from(await stillRes.arrayBuffer());
        const stillPath = path.join(stillsDir, `${index}.jpg`);
        fs.writeFileSync(stillPath, stillBuffer);
        // Pass as base64 data URI to Remotion (existing render.ts contract)
        segmentImages[index] = `data:image/jpeg;base64,${stillBuffer.toString("base64")}`;
      })
    );
    console.log(`[${jobId}] Stills fetched: ${Object.keys(segmentImages).length} files`);

    // Run WhisperX alignment — CPU int8 mode
    console.log(`[${jobId}] Running WhisperX alignment (CPU int8)...`);
    const alignmentResult = runWhisperX(audioPath, pkg);
    console.log(`[${jobId}] Alignment complete: ${alignmentResult.segmentDurations.map((d) => d.toFixed(2)).join(", ")}`);

    // Render video with Remotion
    console.log(`[${jobId}] Starting Remotion render...`);
    const videoPath = await renderVideo(
      pkg,
      storyId,
      audioPath,
      alignmentResult.totalDuration,
      alignmentResult.segmentDurations,
      segmentImages,
      aspectRatio ?? "9:16",
      isWatermarked ?? true
    );
    console.log(`[${jobId}] Render complete: ${videoPath}`);

    // Upload video to B2
    console.log(`[${jobId}] Uploading video to B2...`);
    const outputUrl = await uploadToR2(videoPath, `videos/${jobId}.mp4`);
    console.log(`[${jobId}] Uploaded: ${outputUrl}`);

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch {}
    try { fs.unlinkSync(videoPath); } catch {}
    try {
      fs.readdirSync(stillsDir).forEach((f) => fs.unlinkSync(path.join(stillsDir, f)));
    } catch {}

    return res.json({ outputUrl, durationSec: alignmentResult.totalDuration });
  } catch (err: any) {
    console.error(`[${jobId}] Render failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

function runWhisperX(
  audioPath: string,
  pkg: any
): { segmentDurations: number[]; totalDuration: number } {
  if (!fs.existsSync(ALIGN_SCRIPT)) {
    throw new Error(`Alignment script not found at ${ALIGN_SCRIPT}`);
  }

  const segmentsPath = path.join("output", "segments.json");
  fs.writeFileSync(segmentsPath, JSON.stringify(pkg.segments));

  // Pass --device cpu --compute-type int8 — no GPU required
  const stdout = execFileSync(
    WHISPER_PYTHON,
    [ALIGN_SCRIPT, audioPath, segmentsPath, "--device", "cpu", "--compute-type", "int8"],
    { maxBuffer: 10 * 1024 * 1024 }
  ).toString().trim();

  const lastLine = stdout.split("\n").filter(Boolean).pop() ?? "";
  const parsed = JSON.parse(lastLine);

  return {
    segmentDurations: parsed.segment_durations,
    totalDuration: parsed.total_duration,
  };
}

app.listen(PORT, () => {
  console.log(`Contabo CPU Render API running on port ${PORT}`);
});

export default app;