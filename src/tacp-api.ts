// TACP HTTP API Server — v5 (Railway orchestrator + Contabo CPU renderer)
// POST /generate        -> starts pipeline, returns { jobId }
// GET  /jobs/:jobId     -> polls status
// GET  /health          -> health check

import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateStills } from "./stills/generate-stills.js";
import { uploadToR2 } from "./r2/upload.js";
import "dotenv/config";
import { setGlobalDispatcher, Agent } from "undici";
setGlobalDispatcher(new Agent({ headersTimeout: 5400000, bodyTimeout: 5400000 }));

if (!process.env.DATABASE_URL) {
  throw new Error("Missing required env var: DATABASE_URL");
}

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tacp_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      story_idea TEXT,
      story_id TEXT,
      video_path TEXT,
      error TEXT,
      meta JSONB,
      full_narration TEXT,
      duration_sec FLOAT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RENDER_URLS = [
  process.env.CONTABO_RENDER_URL,
  process.env.CONTABO_RENDER_URL_2,
].filter(Boolean) as string[];
if (RENDER_URLS.length === 0) throw new Error("Missing CONTABO_RENDER_URL");
let renderCounter = 0;
function nextRenderUrl(): string {
  return RENDER_URLS[renderCounter++ % RENDER_URLS.length];
}

type JobStatus =
  | "pending"
  | "generating_package"
  | "generating_audio"
  | "generating_stills"
  | "rendering"
  | "retrying"
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
  durationSec?: number;
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

function rowToJob(row: any): Job {
  return {
    id: row.id,
    status: row.status as JobStatus,
    storyIdea: row.story_idea,
    storyId: row.story_id ?? undefined,
    videoPath: row.video_path ?? undefined,
    error: row.error ?? undefined,
    meta: row.meta ?? undefined,
    fullNarration: row.full_narration ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

async function setStatus(jobId: string, status: JobStatus) {
  await db.query(
    `UPDATE tacp_jobs SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, jobId],
  );
  console.log(`[${jobId}] ${status}`);
}

app.get("/health", async (_req, res) => {
  const { rows } = await db.query(`SELECT COUNT(*) FROM tacp_jobs`);
  res.json({ status: "ok", jobs: Number(rows[0].count), uptime: process.uptime() });
});

app.post("/generate", async (req, res) => {
  const { jobId, storyIdea, customNarration, aspectRatio, targetWordCount, isWatermarked } =
    req.body;
  console.log(`[${jobId}] DEBUG: received aspectRatio = "${aspectRatio}"`);

  if (!jobId || !storyIdea) {
    return res.status(400).json({ error: "jobId and storyIdea are required" });
  }

  const { rows: existing } = await db.query(
    `SELECT * FROM tacp_jobs WHERE id = $1`,
    [jobId],
  );
  if (existing.length > 0) {
    return res.status(409).json({ error: "Job already exists", job: rowToJob(existing[0]) });
  }

  await db.query(
    `INSERT INTO tacp_jobs (id, status, story_idea, started_at) VALUES ($1, 'pending', $2, NOW())`,
    [jobId, storyIdea],
  );

  const doRun = () =>
    runPipeline(
      jobId,
      storyIdea,
      customNarration,
      aspectRatio ?? "9:16",
      targetWordCount ?? 117,
      isWatermarked ?? true,
    );

  doRun().catch(async (err) => {
    console.error(`[${jobId}] Pipeline error:`, err.message, "| cause:", err.cause);

    const isTransient =
      err.message?.includes("fetch failed") ||
      err.message?.includes("ECONNRESET") ||
      err.message?.includes("ETIMEDOUT");

    if (isTransient) {
      console.log(`[${jobId}] Transient error — retrying in 10s`);
      await db.query(
        `UPDATE tacp_jobs SET status = 'retrying', error = NULL, updated_at = NOW() WHERE id = $1`,
        [jobId],
      );
      await new Promise<void>((r) => setTimeout(r, 10_000));
      doRun().catch(async (retryErr) => {
        console.error(`[${jobId}] Retry failed:`, retryErr.message);
        await db.query(
          `UPDATE tacp_jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
          [retryErr.message, jobId],
        );
      });
    } else {
      await db.query(
        `UPDATE tacp_jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
        [err.message, jobId],
      );
    }
  });

  return res.status(202).json({ jobId, status: "pending" });
});

app.get("/jobs/:jobId", async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM tacp_jobs WHERE id = $1`, [req.params.jobId]);
  if (rows.length === 0) return res.status(404).json({ error: "Job not found" });
  return res.json(rowToJob(rows[0]));
});

async function runPipeline(
  jobId: string,
  storyIdea: string,
  customNarration?: string,
  aspectRatio: string = "9:16",
  targetWordCount: number = 117,
  isWatermarked: boolean = true,
): Promise<void> {
  console.log(`\n[${jobId}] Starting pipeline: "${storyIdea}"`);

  // Step 1: Generate package with Claude
  await setStatus(jobId, "generating_package");
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
    pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, existingPkg), "utf-8"));
  } else {
    pkg = await generatePackage(storyIdea, customNarration, targetWordCount);
  }

  const storyId = pkg.story_id;
  await db.query(
    `UPDATE tacp_jobs SET story_id = $1, meta = $2, full_narration = $3, updated_at = NOW() WHERE id = $4`,
    [storyId, JSON.stringify(pkg.meta), pkg.narration?.full_text ?? null, jobId],
  );

  // Step 2: Generate audio with Gemini TTS
  await setStatus(jobId, "generating_audio");
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
  await setStatus(jobId, "generating_stills");
  await generateStills(pkg, storyId, aspectRatio);

  // Step 4: Upload audio + stills to B2 — send URLs to render server, not base64
  // This eliminates ECONNRESET on large payloads and makes the render call tiny (~2KB)
  await setStatus(jobId, "rendering");
  console.log(`[${jobId}] Uploading audio to B2...`);
  const audioUrl = await uploadToR2(audioResult.mp3_path, `audio/${storyId}.wav`);
  console.log(`[${jobId}] Audio uploaded: ${audioUrl}`);

  console.log(`[${jobId}] Uploading stills to B2...`);
  const segmentImageUrls: Record<number, string> = {};
  for (const seg of pkg.segments) {
    const stillPath = path.join("output", "stills", storyId, `${seg.index}.jpg`);
    if (fs.existsSync(stillPath)) {
      const url = await uploadToR2(stillPath, `stills/${storyId}/${seg.index}.jpg`);
      segmentImageUrls[seg.index] = url;
    }
  }
  console.log(`[${jobId}] Stills uploaded: ${Object.keys(segmentImageUrls).length} files`);

  // Step 5: Call render server with URLs only — no base64 blobs
  const renderUrl = nextRenderUrl();
  console.log(`[${jobId}] Sending to render server: ${renderUrl}/render`);
  let renderRes: Response;
  try {
    renderRes = await fetch(`${renderUrl}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        storyId,
        pkg,
        audioUrl,
        segmentImageUrls,
        aspectRatio,
        isWatermarked,
      }),
    });
  } catch (fetchErr: any) {
    console.error(
      `[${jobId}] Fetch to render server threw:`,
      fetchErr.message,
      "| cause:",
      fetchErr.cause,
    );
    throw fetchErr;
  }

  if (!renderRes.ok) {
    const err = await renderRes.text();
    throw new Error(`Render server failed: ${err}`);
  }

  const { outputUrl, durationSec } = (await renderRes.json()) as {
    outputUrl: string;
    durationSec?: number;
  };

  // Cleanup local files (already uploaded to B2)
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

  await db.query(
    `UPDATE tacp_jobs SET status = 'completed', video_path = $1, completed_at = NOW(), duration_sec = $2, updated_at = NOW() WHERE id = $3`,
    [outputUrl, durationSec ?? null, jobId],
  );

  console.log(`[${jobId}] Done: ${outputUrl}`);
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`TACP API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

export default app;
