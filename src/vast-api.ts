import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { renderVideo } from "./remotion/render.js";
import { uploadToR2 } from "./r2/upload.js";
import { generateStill } from "../imageGen.js";
import "dotenv/config";

const app = express();
app.use(cors());

// Important: Handle both JSON and raw body
app.use(express.json({ limit: "500mb" }));
app.use(express.raw({ type: "application/json", limit: "500mb" }));

const PORT = process.env.PORT || 3002;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/render", async (req, res) => {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    try {
      body = JSON.parse(req.body.toString());
    } catch (e2) {
      console.error("Failed to parse body:", req.body?.toString?.().slice(0, 200));
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const { jobId, storyId, pkg, audioBase64 } = body;
  if (!jobId || !storyId || !pkg || !audioBase64) {
    return res.status(400).json({ error: "jobId, storyId, pkg, audioBase64 required" });
  }

  console.log(`[${jobId}] Render request received`);

  try {
    // Write audio
    const audioDir = path.join("output", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${storyId}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));

    // Generate stills locally
    console.log(`[${jobId}] Generating stills...`);
    for (const seg of pkg.segments || []) {
      const prompt = seg.video_prompt || seg.narration_text || "cinematic historical scene";
      await generateStill(prompt, storyId, seg.index);
    }

    // WhisperX
    console.log(`[${jobId}] Running WhisperX...`);
    const alignmentResult = runWhisperX(audioPath, pkg);

    // Remotion render
    const videoPath = await renderVideo(pkg, storyId, audioPath, alignmentResult.totalDuration, alignmentResult.segmentDurations);

    // Upload
    const outputUrl = await uploadToR2(videoPath, `videos/${jobId}.mp4`);

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch {}
    try { fs.unlinkSync(videoPath); } catch {}

    return res.json({ outputUrl });
  } catch (err: any) {
    console.error(`[${jobId}] Render failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

function runWhisperX(audioPath: string, pkg: any) {
  // ... (keep the same WhisperX function from my previous message)
  const whisperPython = process.env.WHISPERX_PYTHON ?? "python3";
  const script = `...same python script as before...`;  // Paste the full script from previous response

  const outputDir = path.join("output");
  fs.mkdirSync(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, "align.py");
  const segmentsPath = path.join(outputDir, "segments.json");

  fs.writeFileSync(scriptPath, script);
  fs.writeFileSync(segmentsPath, JSON.stringify(pkg.segments || []));

  const result = execSync(
    `${whisperPython} "${scriptPath}" "${audioPath}" "${segmentsPath}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  ).toString().trim();

  return JSON.parse(result);
}

app.listen(PORT, () => console.log(`Vast.ai Render API running on port ${PORT}`));