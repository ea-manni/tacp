// TACP — Toledot Automated Content Pipeline
// Single command: story idea → finished MP4
// Usage: npx tsx src/orchestrator.ts "your story idea here"
// Resume-safe: skips steps that already have output on disk

import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateClips } from "./clips/generate-clips.js";
import { renderVideo } from "./remotion/render.js";
import "dotenv/config";

async function run() {
  const storyIdea = process.argv[2];
  if (!storyIdea) {
    console.error('Usage: npx tsx src/orchestrator.ts "your story idea here"');
    process.exit(1);
  }

  console.log("\n🚀 TACP — Toledot Automated Content Pipeline");
  console.log("=".repeat(50));
  console.log(`📖 Story: ${storyIdea}`);
  console.log("=".repeat(50));

  const startTime = Date.now();

  // ── Step 1: Generate story package with Claude ──────────────────────────────
  // Derive a candidate story ID from the idea to check for existing package
  const candidateId = storyIdea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);

  // Check if any package matching the idea already exists
  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });
  const existingPkg = fs.readdirSync(packagesDir).find((f) =>
    f.endsWith(".json") && f.includes(candidateId.slice(0, 20))
  );

  let pkg: any;
  let storyId: string;

  if (existingPkg) {
    console.log(`\n[1/4] ⏭️  Package exists — loading ${existingPkg}`);
    pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, existingPkg), "utf-8"));
    storyId = pkg.story_id;
    console.log(`✅ Story ID: ${storyId}`);
  } else {
    console.log("\n[1/4] Claude — Generating story package...");
    pkg = await generatePackage(storyIdea);
    storyId = (pkg as any).story_id;
    console.log(`✅ Story ID: ${storyId}`);
  }

  // ── Step 2: Generate audio with Gemini TTS ──────────────────────────────────
  const audioWavPath = path.join("output", "audio", `${storyId}.wav`);
  const audioMp3Path = path.join("output", "audio", `${storyId}.mp3`);

  let audioResult: { mp3_path: string; duration_sec: number };

  // Check for existing audio (wav or mp3)
  if (fs.existsSync(audioWavPath) || fs.existsSync(audioMp3Path)) {
    const existingPath = fs.existsSync(audioWavPath) ? audioWavPath : audioMp3Path;
    const estimatedDuration = pkg.narration?.estimated_duration_sec ?? 60;
    console.log(`\n[2/4] ⏭️  Audio exists — skipping TTS (${existingPath})`);
    audioResult = { mp3_path: existingPath, duration_sec: estimatedDuration };
  } else {
    console.log("\n[2/4] Gemini TTS — Generating narration...");
    audioResult = await synthesize(pkg, storyId);
    console.log(`✅ Audio: ${audioResult.duration_sec.toFixed(1)}s`);
  }

  // ── Step 3: Generate video clips ────────────────────────────────────────────
  console.log("\n[3/4] Generating video clips...");
  await generateClips(pkg, storyId);
  console.log(`✅ All clips generated`);

  // ── Step 4: Render final video with Remotion ─────────────────────────────────
  console.log("\n[4/4] Remotion — Rendering final video...");
  const videoPath = await renderVideo(
    pkg,
    storyId,
    audioResult.mp3_path,
    audioResult.duration_sec
  );

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n" + "=".repeat(50));
  console.log("🎉 TACP COMPLETE!");
  console.log("=".repeat(50));
  console.log(`📹 Video: ${videoPath}`);
  console.log(`⏱️  Total time: ${elapsed} minutes`);
  console.log(`📝 Package: output/packages/${storyId}.json`);
  console.log(`🔊 Audio: ${audioResult.mp3_path}`);
  console.log(`🎬 Clips: output/clips/${storyId}/`);
  console.log("=".repeat(50));

  // Print social media package
  const meta = pkg.meta ?? (pkg as any);
  console.log("\n📱 SOCIAL MEDIA PACKAGE");
  console.log("-".repeat(30));
  console.log("TITLES:");
  const titles = meta.title_options ?? [];
  titles.forEach((t: string, i: number) => console.log(`  ${i + 1}. ${t}`));
  console.log("\nPINNED COMMENT:");
  console.log(`  ${meta.pinned_comment ?? ""}`);
  console.log("\nTWITTER:");
  console.log(`  ${meta.captions?.twitter ?? ""}`);
}

run().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message);
  console.error(err);
  process.exit(1);
});