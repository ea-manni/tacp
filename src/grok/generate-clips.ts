// Generates video clips for each segment using xAI Grok Imagine API.
// Submits all clips in parallel batches, polls until done, downloads MP4s.

import * as fs from "fs";
import * as path from "path";
import type { VideoPackage, Segment } from "../types.js";
import "dotenv/config";

const XAI_BASE = "https://api.x.ai/v1";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300000; // 5 minutes per clip
const BATCH_SIZE = 4; // parallel clips at once

interface ClipResult {
  index: number;
  path: string;
}

async function submitClip(
  segment: Segment,
  apiKey: string
): Promise<string> {
  const response = await fetch(`${XAI_BASE}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-video",
      prompt: segment.grok_prompt,
      duration: 6,
      aspect_ratio: "9:16",
      resolution: "720p",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok submit error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.request_id;
}

async function pollClip(
  requestId: string,
  apiKey: string,
  index: number
): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${XAI_BASE}/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok poll error ${res.status}: ${err}`);
    }

    const data = await res.json();

    if (data.status === "done") {
      console.log(`   ✅ Clip ${index} ready`);
      return data.video.url;
    }

    if (data.status === "failed" || data.status === "error" || data.status === "expired") {
      throw new Error(`Clip ${index} failed: ${JSON.stringify(data)}`);
    }

    console.log(`   ⏳ Clip ${index}: ${data.status}...`);
  }

  throw new Error(`Clip ${index} timed out after 5 minutes`);
}

async function downloadClip(
  url: string,
  outputPath: string
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function processSegment(
  segment: Segment,
  outputDir: string,
  apiKey: string
): Promise<ClipResult> {
  const outputPath = path.join(outputDir, `${segment.index}.mp4`);

  // Skip if already downloaded (resume support)
  if (fs.existsSync(outputPath)) {
    console.log(`   ⏭️  Clip ${segment.index} already exists, skipping`);
    return { index: segment.index, path: outputPath };
  }

  // Respect xAI rate limit: 1 request/second
  await new Promise((r) => setTimeout(r, segment.index * 2000));
  console.log(`   📤 Submitting clip ${segment.index}...`);
  const requestId = await submitClip(segment, apiKey);

  const videoUrl = await pollClip(requestId, apiKey, segment.index);
  await downloadClip(videoUrl, outputPath);

  return { index: segment.index, path: outputPath };
}

export async function generateClips(
  pkg: VideoPackage,
  storyId: string
): Promise<ClipResult[]> {
  console.log("\n🎬 Starting Grok clip generation...");
  console.log(`   Story: ${storyId}`);
  console.log(`   Clips: ${pkg.segments.length}`);

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY not set in .env");

  // Create output directory
  const outputDir = path.join("output", "clips", storyId);
  fs.mkdirSync(outputDir, { recursive: true });

  const results: ClipResult[] = [];
  const segments = [...pkg.segments];

  // Process in batches
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

    console.log(
      `\n   🎞️  Batch ${batchNum}/${totalBatches} (clips ${batch[0].index}–${batch[batch.length - 1].index})`
    );

    const batchResults = await Promise.all(
      batch.map((segment) =>
        processSegment(segment, outputDir, apiKey)
      )
    );

    results.push(...batchResults);
    console.log(`   ✅ Batch ${batchNum} complete`);
  }

  // Verify all clips downloaded
  const missing = results.filter((r) => !fs.existsSync(r.path));
  if (missing.length > 0) {
    throw new Error(
      `Missing clips: ${missing.map((r) => r.index).join(", ")}`
    );
  }

  console.log(`\n✅ All ${results.length} clips saved to output/clips/${storyId}/`);
  return results;
}

// Run directly
if (process.argv[1].endsWith("generate-clips.ts")) {
  const pkgPath = process.argv[2];
  if (!pkgPath) {
    console.error(
      'Usage: npx tsx src/grok/generate-clips.ts "output/packages/<story_id>.json"'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(pkgPath, "utf-8");
  const pkg: VideoPackage = JSON.parse(raw);
  const storyId = (pkg as any).story_id || path.basename(pkgPath, ".json");

  generateClips(pkg, storyId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}