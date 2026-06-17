// TACP HTTP API Server — v4 (Railway orchestrator + Vast.ai renderer)
// POST /generate        -> starts pipeline, returns { jobId }
// GET  /jobs/:jobId     -> polls status
// GET  /health          -> health check

import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateStills } from "./stills/generate-stills.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VAST_RENDER_URL = process.env.VAST_RENDER_URL!;

type JobStatus =
  | "pending"
  | "generating_package"
  | "generating_audio"
  | "generating_stills"
  | "rendering"
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
  meta?: {
    title_options: string[];
    thumbnail_prompt: string;
    description: string;
    tags: string[];
    hashtags: string[];
    chapters: { time: string; label: string }[];
    pinned_comment: string;
    captions: {
      youtube_shorts: string;
      tiktok: string;
      instagram: string;
      twitter: string;
    };
  };
  fullNarration?: string;
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
  const { jobId, storyIdea, customNarration, aspectRatio, targetWordCount } =
    req.body;
  console.log(`[${jobId}] DEBUG: received aspectRatio = "${aspectRatio}"`);

  if (!jobId || !storyIdea) {
    return res.status(400).json({ error: "jobId and storyIdea are required" });
  }

  if (jobStore.has(jobId)) {
    return res
      .status(409)
      .json({ error: "Job already exists", job: jobStore.get(jobId) });
  }

  jobStore.set(jobId, {
    id: jobId,
    status: "pending",
    storyIdea,
    startedAt: new Date(),
  });

  runPipeline(
    jobId,
    storyIdea,
    customNarration,
    aspectRatio ?? "9:16",
    targetWordCount ?? 117,
  ).catch((err) => {
    console.error(`[${jobId}] Pipeline error:`, err.message, "| cause:", err.cause);
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
  customNarration?: string,
  aspectRatio: string = "9:16",
  targetWordCount: number = 117,
): Promise<void> {
  const job = jobStore.get(jobId)!;

  console.log(`\n[${jobId}] Starting pipeline: "${storyIdea}"`);

  // Step 1: Generate package with Claude
  setStatus(jobId, "generating_package");
  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  const candidateId = storyIdea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);

  const existingPkg = fs
    .readdirSync(packagesDir)
    .find(
      (f) =>
        f.endsWith(".json") &&
        f.includes(candidateId.slice(0, 20)) &&
        f.includes(`_w${targetWordCount}`),
    );

  let pkg: any;
  if (existingPkg) {
    console.log(`[${jobId}] Package exists — loading ${existingPkg}`);
    pkg = JSON.parse(
      fs.readFileSync(path.join(packagesDir, existingPkg), "utf-8"),
    );
  } else {
    pkg = await generatePackage(storyIdea, customNarration, targetWordCount);
  }

  const storyId = pkg.story_id;
  job.storyId = storyId;
  job.meta = pkg.meta;
  job.fullNarration = pkg.narration?.full_text;

  // Step 2: Generate audio with Gemini TTS
  setStatus(jobId, "generating_audio");
  const audioWavPath = path.join("output", "audio", `${storyId}.wav`);

  let audioResult: {
    mp3_path: string;
    duration_sec: number;
    segment_durations: number[];
  };

  if (fs.existsSync(audioWavPath)) {
    const estimatedDuration = pkg.narration?.estimated_duration_sec ?? 60;
    const totalChars = pkg.segments.reduce(
      (a: number, s: any) => a + s.narration_text.length,
      0,
    );
    const segmentDurations = pkg.segments.map(
      (s: any) => (s.narration_text.length / totalChars) * estimatedDuration,
    );
    console.log(`[${jobId}] Audio exists — skipping TTS`);
    audioResult = {
      mp3_path: audioWavPath,
      duration_sec: estimatedDuration,
      segment_durations: segmentDurations,
    };
  } else {
    audioResult = await synthesize(pkg, storyId);
  }

  // Step 3: Generate stills with Cloudflare Workers AI
  setStatus(jobId, "generating_stills");
  await generateStills(pkg, storyId, aspectRatio);

  // Step 4: Send to Vast.ai for WhisperX alignment + Remotion render + B2 upload
  setStatus(jobId, "rendering");
  console.log(`[${jobId}] Sending to Vast.ai for render...`);

  // Read audio as base64
  const audioBase64 = fs.readFileSync(audioResult.mp3_path).toString("base64");

  // Read stills as base64
  const segmentImages: Record<number, string> = {};
  for (const seg of pkg.segments) {
    const stillPath = path.join(
      "output",
      "stills",
      storyId,
      `${seg.index}.jpg`,
    );
    if (fs.existsSync(stillPath)) {
      const b64 = fs.readFileSync(stillPath).toString("base64");
      segmentImages[seg.index] = `data:image/jpeg;base64,${b64}`;
    }
  }

  // Call Vast.ai render endpoint
  console.log(`[${jobId}] Calling VAST_RENDER_URL: ${VAST_RENDER_URL}/render`);
  let renderRes: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30 min
    renderRes = await fetch(`${VAST_RENDER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        storyId,
        pkg,
        audioBase64,
        segmentImages,
        aspectRatio,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
  } catch (fetchErr: any) {
    console.error(`[${jobId}] Fetch to Vast.ai threw:`, fetchErr.message, "| cause:", fetchErr.cause);
    throw fetchErr;
  }

  if (!renderRes.ok) {
    const err = await renderRes.text();
    throw new Error(`Vast.ai render failed: ${err}`);
  }

  const { outputUrl } = (await renderRes.json()) as { outputUrl: string };

  // Cleanup local files
  try {
    fs.unlinkSync(audioResult.mp3_path);
  } catch {}
  const stillsDir = path.join("output", "stills", storyId);
  if (fs.existsSync(stillsDir)) {
    fs.readdirSync(stillsDir).forEach((f) => {
      try {
        fs.unlinkSync(path.join(stillsDir, f));
      } catch {}
    });
  }

  job.status = "completed";
  job.videoPath = outputUrl;
  job.completedAt = new Date();

  console.log(`[${jobId}] Done: ${outputUrl}`);
}

app.listen(PORT, () => {
  console.log(`TACP API running on port ${PORT}`);
});

export default app;
