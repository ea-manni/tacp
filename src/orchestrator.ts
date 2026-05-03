// TACP — Toledot Automated Content Pipeline
// Single command: story idea → finished MP4
// Usage: npx tsx src/orchestrator.ts "your story idea here"

import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./elevenlabs/synthesize.js";
import { generateClips } from "./grok/generate-clips.js";
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

  // Step 1: Generate story package with Claude
  console.log("\n[1/4] Claude — Generating story package...");
  const pkg = await generatePackage(storyIdea);
  const storyId = (pkg as any).story_id;
  console.log(`✅ Story ID: ${storyId}`);

  // Step 2: Generate audio with Gemini TTS
  console.log("\n[2/4] Gemini TTS — Generating narration...");
  const audioResult = await synthesize(pkg, storyId);
  console.log(`✅ Audio: ${audioResult.duration_sec.toFixed(1)}s`);

  // Step 3: Generate video clips with Grok
  console.log("\n[3/4] Grok — Generating video clips...");
  await generateClips(pkg, storyId);
  console.log(`✅ All clips generated`);

  // Step 4: Render final video with Remotion
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
  console.log(`🔊 Audio: output/audio/${storyId}.wav`);
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