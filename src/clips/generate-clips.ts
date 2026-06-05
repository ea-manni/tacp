import * as fs from "fs";
import * as path from "path";
import type { VideoPackage, Segment } from "../types.js";
import "dotenv/config";

const POLL_INTERVAL_MS = 10000;   // poll every 10 seconds
const MAX_WAIT_MS = 1800000;      // 30 minute timeout per clip

interface ClipResult {
  index: number;
  path: string;
}

async function generateClip(
  segment: Segment,
  outputDir: string,
  baseUrl: string
): Promise<ClipResult> {
  const outputPath = path.join(outputDir, `${segment.index}.mp4`);

  if (fs.existsSync(outputPath)) {
    console.log(`   ⏭️  Clip ${segment.index} already exists, skipping`);
    return { index: segment.index, path: outputPath };
  }

  console.log(`   📤 Submitting clip ${segment.index}...`);

  // Submit generation job — returns immediately with clip_id
  const res = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: segment.video_prompt ?? segment.grok_prompt,
      duration: 5,
      width: 480,
      height: 832,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Submit failed for clip ${segment.index}: ${err}`);
  }

  const { clip_id } = await res.json();
  console.log(`   ⏳ Clip ${segment.index} queued (${clip_id.slice(0, 8)}) — polling...`);

  // Poll /status/{clip_id} until done or error
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let statusData: any;
    try {
      const statusRes = await fetch(`${baseUrl}/status/${clip_id}`, {
        signal: AbortSignal.timeout(10000),
      });
      statusData = await statusRes.json();
    } catch {
      console.log(`   ⚠️  Poll failed for clip ${segment.index} — retrying...`);
      continue;
    }

    const elapsed = statusData.elapsed_sec ?? Math.round((Date.now() - start) / 1000);
    console.log(`   [${elapsed}s] Clip ${segment.index}: ${statusData.status}`);

    if (statusData.status === "done") {
      break;
    }

    if (statusData.status === "error") {
      throw new Error(`Generation error for clip ${segment.index}: ${statusData.error}`);
    }

    // queued | running — keep polling
  }

  // Download the clip
  console.log(`   📥 Downloading clip ${segment.index}...`);
  const dlRes = await fetch(`${baseUrl}/download/${clip_id}`, {
    signal: AbortSignal.timeout(60000),
  });

  if (!dlRes.ok) {
    throw new Error(`Download failed for clip ${segment.index}: ${dlRes.status}`);
  }

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ Clip ${segment.index} saved (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);

  return { index: segment.index, path: outputPath };
}

export async function generateClips(
  pkg: VideoPackage,
  storyId: string,
  existingInstanceId?: number
): Promise<ClipResult[]> {
  console.log("\n🎬 Starting clip generation via RunPod + Wan2.2-TI2V-5B...");
  console.log(`   Story: ${storyId}`);
  console.log(`   Clips: ${pkg.segments.length}`);

  const outputDir = path.join("output", "clips", storyId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Full resume — skip if all clips exist
  const allExist = pkg.segments.every((seg) =>
    fs.existsSync(path.join(outputDir, `${seg.index}.mp4`))
  );

  if (allExist) {
    console.log("   ⏭️  All clips already exist, skipping generation");
    return pkg.segments.map((seg) => ({
      index: seg.index,
      path: path.join(outputDir, `${seg.index}.mp4`),
    }));
  }

  // Read session from disk
  const SESSION_FILE = path.join("output", "runpod-session.json");
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error("No active session. Run: npx tsx src/runpod/start-session.ts");
  }
  const instance = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  console.log(`   Using session: ${instance.baseUrl}`);

  const results: ClipResult[] = [];

  // Generate clips sequentially
  for (const segment of pkg.segments) {
    const result = await generateClip(segment, outputDir, instance.baseUrl);
    results.push(result);
  }

  console.log(`\n✅ All ${results.length} clips saved to output/clips/${storyId}/`);
  return results;
}

// Run directly
if (process.argv[1].endsWith("generate-clips.ts")) {
  const pkgPath = process.argv[2];
  if (!pkgPath) {
    console.error(
      'Usage: npx tsx src/clips/generate-clips.ts "output/packages/<story_id>.json"'
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