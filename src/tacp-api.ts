// TACP HTTP API Server
// Wraps the orchestrator pipeline and exposes it over HTTP for Eyita worker
// Deploy on Railway as a separate service

import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateClips } from "./clips/generate-clips.js";
import { renderVideo } from "./remotion/render.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ── In-memory job store ───────────────────────────────────────────────────────
// For beta: single Railway instance, sequential jobs
// Later: move to Postgres/BullMQ job tracking
interface Job {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  storyIdea: string;
  storyId?: string;
  videoPath?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

const jobStore = new Map<string, Job>();

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    jobs: jobStore.size,
    uptime: process.uptime(),
  });
});

// ── POST /generate ────────────────────────────────────────────────────────────
// Submit a video generation job — returns immediately with jobId
app.post("/generate", async (req, res) => {
  const { jobId, storyIdea, sessionUrl } = req.body;

  if (!jobId || !storyIdea) {
    return res.status(400).json({ error: "jobId and storyIdea are required" });
  }

  if (!sessionUrl) {
    return res.status(400).json({ error: "sessionUrl (Vast.ai GPU URL) is required" });
  }

  // Check for duplicate
  if (jobStore.has(jobId)) {
    return res.status(409).json({ error: "Job already exists", job: jobStore.get(jobId) });
  }

  // Register job
  jobStore.set(jobId, {
    id: jobId,
    status: "pending",
    storyIdea,
    startedAt: new Date(),
  });

  // Write session file for generate-clips.ts to read
  const sessionFile = path.join("output", "runpod-session.json");
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ id: jobId, baseUrl: sessionUrl }));

  // Run pipeline in background — don't await
  runPipeline(jobId, storyIdea).catch((err) => {
    console.error(`[${jobId}] Pipeline error:`, err.message);
    const job = jobStore.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err.message;
    }
  });

  return res.status(202).json({ jobId, status: "pending" });
});

// ── GET /jobs/:jobId ──────────────────────────────────────────────────────────
// Poll job status
app.get("/jobs/:jobId", (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(job);
});

// ── GET /jobs/:jobId/download ─────────────────────────────────────────────────
// Download completed video
app.get("/jobs/:jobId/download", (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "completed") {
    return res.status(400).json({ error: `Job not ready — status: ${job.status}` });
  }
  if (!job.videoPath || !fs.existsSync(job.videoPath)) {
    return res.status(500).json({ error: "Video file missing" });
  }

  return res.download(job.videoPath, `${job.storyId}.mp4`);
});

// ── Pipeline runner ───────────────────────────────────────────────────────────
async function runPipeline(jobId: string, storyIdea: string): Promise<void> {
  const job = jobStore.get(jobId)!;
  job.status = "processing";

  console.log(`\n[${jobId}] Starting pipeline: "${storyIdea}"`);

  // Step 1: Generate package (resume-safe)
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
    console.log(`[${jobId}] Generating package...`);
    pkg = await generatePackage(storyIdea);
  }

  const storyId = pkg.story_id;
  job.storyId = storyId;

  // Step 2: TTS (resume-safe)
  const audioWavPath = path.join("output", "audio", `${storyId}.wav`);
  const audioMp3Path = path.join("output", "audio", `${storyId}.mp3`);

  let audioResult: { mp3_path: string; duration_sec: number };
  if (fs.existsSync(audioWavPath) || fs.existsSync(audioMp3Path)) {
    const existingPath = fs.existsSync(audioWavPath) ? audioWavPath : audioMp3Path;
    console.log(`[${jobId}] Audio exists — skipping TTS`);
    audioResult = {
      mp3_path: existingPath,
      duration_sec: pkg.narration?.estimated_duration_sec ?? 60,
    };
  } else {
    console.log(`[${jobId}] Generating audio...`);
    audioResult = await synthesize(pkg, storyId);
  }

  // Step 3: Generate clips
  console.log(`[${jobId}] Generating clips...`);
  await generateClips(pkg, storyId);

  // Step 4: Render
  console.log(`[${jobId}] Rendering video...`);
  const videoPath = await renderVideo(
    pkg,
    storyId,
    audioResult.mp3_path,
    audioResult.duration_sec
  );

  job.status = "completed";
  job.videoPath = videoPath;
  job.completedAt = new Date();

  console.log(`[${jobId}] ✅ Done: ${videoPath}`);
}

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TACP API running on port ${PORT}`);
});

export default app;