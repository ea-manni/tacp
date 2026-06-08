// TACP HTTP API Server — v3 (stills-first, no GPU)
// POST /generate        → starts pipeline, returns { jobId }
// GET  /jobs/:jobId     → polls status
// GET  /health          → health check

import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateStills } from "./stills/generate-stills.js";
import { renderVideo } from "./remotion/render.js";
import { uploadToR2 } from "./r2/upload.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

type JobStatus =
  | "pending"
  | "generating_package"
  | "generating_audio"
  | "generating_stills"
  | "rendering"
  | "uploading"
  | "completed"
  | "failed";

interface Job {
  id: string;
  status: JobStatus;
  storyIdea: string;
  storyId?: string;
  videoPath?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

const jobStore = new Map<string, Job>();

function setStatus(jobId: string, status: JobStatus) {
  const job = jobStore.get(jobId);
  if (job) {
    job.status = status;
    console.log(`[${jobId}] ${status}`);
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", jobs: jobStore.size, uptime: process.uptime() });
});

app.post("/generate", (req, res) => {
  const { jobId, storyIdea, customNarration } = req.body;

  if (!jobId || !storyIdea) {
    return res.status(400).json({ error: "jobId and storyIdea are required" });
  }

  if (jobStore.has(jobId)) {
    return res.status(409).json({ error: "Job already exists", job: jobStore.get(jobId) });
  }

  jobStore.set(jobId, {
    id: jobId,
    status: "pending",
    storyIdea,
    startedAt: new Date(),
  });

  runPipeline(jobId, storyIdea, customNarration).catch((err) => {
    console.error(`[${jobId}] Pipeline error:`, err.message);
    const job = jobStore.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err.message;
    }
  });

  return res.status(202).json({ jobId, status: "pending" });
});

app.get("/jobs/:jobId", (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(job);
});

async function runPipeline(
  jobId: string,
  storyIdea: string,
  customNarration?: string
): Promise<void> {
  const job = jobStore.get(jobId)!;

  console.log(`\n[${jobId}] Starting pipeline: "${storyIdea}"`);

  // Step 1: Package
  setStatus(jobId, "generating_package");
  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  const candidateId = storyIdea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);

  const existingPkg = fs.readdirSync(packagesDir).find(
    (f) => f.endsWith(".json") && f.includes(candidateId.slice(0, 20))
  );

  let pkg: any;
  if (existingPkg) {
    console.log(`[${jobId}] Package exists — loading ${existingPkg}`);
    pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, existingPkg), "utf-8"));
  } else {
    pkg = await generatePackage(storyIdea, customNarration);
  }

  const storyId = pkg.story_id;
  job.storyId = storyId;

  // Step 2: Audio
  setStatus(jobId, "generating_audio");
  const audioWavPath = path.join("output", "audio", `${storyId}.wav`);
  const audioMp3Path = path.join("output", "audio", `${storyId}.mp3`);

  let audioResult: { mp3_path: string; duration_sec: number; segment_durations: number[] };

  if (fs.existsSync(audioWavPath) || fs.existsSync(audioMp3Path)) {
    const existingPath = fs.existsSync(audioWavPath) ? audioWavPath : audioMp3Path;
    const estimatedDuration = pkg.narration?.estimated_duration_sec ?? 60;
    const totalChars = pkg.segments.reduce((a: number, s: any) => a + s.narration_text.length, 0);
    const segmentDurations = pkg.segments.map((s: any) =>
      (s.narration_text.length / totalChars) * estimatedDuration
    );
    console.log(`[${jobId}] Audio exists — skipping TTS`);
    audioResult = { mp3_path: existingPath, duration_sec: estimatedDuration, segment_durations: segmentDurations };
  } else {
    audioResult = await synthesize(pkg, storyId);
  }

  // Step 3: Stills
  setStatus(jobId, "generating_stills");
  await generateStills(pkg, storyId);

  // Step 4: Render
  setStatus(jobId, "rendering");
  const videoPath = await renderVideo(
    pkg,
    storyId,
    audioResult.mp3_path,
    audioResult.duration_sec,
    audioResult.segment_durations
  );

  // Step 5: Upload to B2
  setStatus(jobId, "uploading");
  const r2Url = await uploadToR2(videoPath, `videos/${jobId}.mp4`);

  try { fs.unlinkSync(videoPath); } catch {}

  job.status = "completed";
  job.videoPath = r2Url;
  job.completedAt = new Date();

  console.log(`[${jobId}] Done: ${r2Url}`);
}

app.listen(PORT, () => {
  console.log(`TACP API running on port ${PORT}`);
});

export default app;