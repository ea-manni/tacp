import * as fs from "fs";
import * as path from "path";
import type { VideoPackage, Segment } from "../types.js";
import { destroyInstance } from "../vastai/vast-manager.js";
import "dotenv/config";

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

  console.log(`   📤 Generating clip ${segment.index}...`);

  // Submit generation request
  const res = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: segment.grok_prompt,
      duration: 5,
      width: 480,
      height: 832,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Generation failed for clip ${segment.index}: ${err}`);
  }

  const data = await res.json();
  const clipId = data.clip_id;

  // Download the clip
  console.log(`   📥 Downloading clip ${segment.index}...`);
  const dlRes = await fetch(`${baseUrl}/download/${clipId}`);

  if (!dlRes.ok) {
    throw new Error(`Download failed for clip ${segment.index}`);
  }

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ Clip ${segment.index} saved`);

  return { index: segment.index, path: outputPath };
}

export async function generateClips(
  pkg: VideoPackage,
  storyId: string,
  existingInstanceId?: number
): Promise<ClipResult[]> {
  console.log("\n🎬 Starting clip generation via Vast.ai + LTX-2.3...");
  console.log(`   Story: ${storyId}`);
  console.log(`   Clips: ${pkg.segments.length}`);

  const outputDir = path.join("output", "clips", storyId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Check if all clips already exist (full resume)
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
  const SESSION_FILE = path.join("output", "vastai-session.json");
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error("No active session. Run: npx tsx src/vastai/start-session.ts");
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