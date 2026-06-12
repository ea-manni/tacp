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

// Accept ANY body type
app.use(express.raw({ limit: "500mb" }));
app.use(express.text({ limit: "500mb" }));
app.use(express.json({ limit: "500mb" }));

const PORT = process.env.PORT || 3002;

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/render", async (req, res) => {
  console.log(`[render] Raw body type: ${typeof req.body}, length: ${String(req.body).length}`);

  let body;
  try {
    let raw = req.body;
    if (Buffer.isBuffer(raw)) raw = raw.toString();
    if (typeof raw === "string") raw = raw.trim();

    // Try multiple parsing strategies
    if (typeof raw === "string" && raw.startsWith("{")) {
      body = JSON.parse(raw);
    } else if (typeof req.body === "object" && req.body !== null) {
      body = req.body;
    } else {
      throw new Error("Could not parse body");
    }
  } catch (e) {
    console.error("Body parse failed. First 300 chars:", String(req.body).slice(0, 300));
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { jobId, storyId, pkg, audioBase64 } = body;
  if (!jobId || !storyId || !pkg || !audioBase64) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log(`[${jobId}] Render request accepted`);

  try {
    // Audio
    const audioDir = path.join("output", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${storyId}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));

    // WhisperX
    const alignmentResult = runWhisperX(audioPath, pkg);

    // Render
    const videoPath = await renderVideo(
      pkg, storyId, audioPath, alignmentResult.totalDuration, alignmentResult.segmentDurations
    );

    const outputUrl = await uploadToR2(videoPath, `videos/${jobId}.mp4`);

    return res.json({ outputUrl });
  } catch (err: any) {
    console.error(`[${jobId}] Failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

function runWhisperX(audioPath: string, pkg: any) {
  // ... (same as before - keep the WhisperX function)
  const whisperPython = process.env.WHISPER_PYTHON ?? "python3";
  const script = `... paste the full python script from previous messages ...`;

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