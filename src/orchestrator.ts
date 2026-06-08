// TACP Ã¢â‚¬â€ Toledot Automated Content Pipeline
// Usage (generate from idea):  npx tsx src/orchestrator.ts "your story idea"
// Usage (custom narration):    npx tsx src/orchestrator.ts --custom "your written story"
// Resume-safe: skips steps that already have output on disk

import * as fs from "fs";
import * as path from "path";
import { generatePackage } from "./claude/generate-package.js";
import { synthesize } from "./tts/synthesize.js";
import { generateStills } from "./stills/generate-stills.js";
import { renderVideo } from "./remotion/render.js";
import "dotenv/config";

async function run() {
  // -- Parse arguments -------------------------------------------------------
  const args = process.argv.slice(2);
  const customFlag = args.indexOf("--custom");

  let storyIdea: string;
  let customNarration: string | undefined;

  if (customFlag !== -1) {
    customNarration = args[customFlag + 1];
    if (!customNarration) {
      console.error('Usage: npx tsx src/orchestrator.ts --custom "your story text"');
      process.exit(1);
    }
    storyIdea = customNarration
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
      .slice(0, 60);
  } else {
    storyIdea = args[0];
    if (!storyIdea) {
      console.error('Usage: npx tsx src/orchestrator.ts "your story idea"');
      process.exit(1);
    }
  }

  console.log("\nTACP Ã¢â‚¬â€ Toledot Automated Content Pipeline");
  console.log("=".repeat(50));
  console.log(`Mode:  ${customNarration ? "custom narration" : "generate from idea"}`);
  console.log(`Input: ${storyIdea}`);
  console.log("=".repeat(50));

  const startTime = Date.now();

  // -- Step 1: Generate story package with Claude ----------------------------
  const candidateId = storyIdea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);

  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });

  const existingPkg = fs.readdirSync(packagesDir).find(
    (f) => f.endsWith(".json") && f.includes(candidateId.slice(0, 20))
  );

  let pkg: any;
  let storyId: string;

  if (existingPkg) {
    console.log(`\n[1/4] Package exists Ã¢â‚¬â€ loading ${existingPkg}`);
    pkg = JSON.parse(fs.readFileSync(path.join(packagesDir, existingPkg), "utf-8"));
    storyId = pkg.story_id;
    console.log(`      Story ID: ${storyId}`);
  } else {
    console.log("\n[1/4] Generating story package...");
    pkg = await generatePackage(storyIdea, customNarration);
    storyId = pkg.story_id;
  }

  // -- Step 2: Generate narration audio --------------------------------------
  const audioWavPath = path.join("output", "audio", `${storyId}.wav`);
  const audioMp3Path = path.join("output", "audio", `${storyId}.mp3`);

  let audioResult: { mp3_path: string; duration_sec: number };

  if (fs.existsSync(audioWavPath) || fs.existsSync(audioMp3Path)) {
    const existingPath = fs.existsSync(audioWavPath) ? audioWavPath : audioMp3Path;
    const estimatedDuration = pkg.narration?.estimated_duration_sec ?? 60;
    console.log(`\n[2/4] Audio exists Ã¢â‚¬â€ skipping TTS (${existingPath})`);
    audioResult = { mp3_path: existingPath, duration_sec: estimatedDuration };
  } else {
    console.log("\n[2/4] Generating narration...");
    audioResult = await synthesize(pkg, storyId);
    console.log(`      Duration: ${audioResult.duration_sec.toFixed(1)}s`);
  }

  // -- Step 3: Generate stills via AI Horde ----------------------------------
  console.log("\n[3/4] Generating stills...");
  await generateStills(pkg, storyId);

  // -- Step 4: Render final video with Remotion ------------------------------
  console.log("\n[4/4] Rendering video...");
  const videoPath = await renderVideo(
    pkg,
    storyId,
    audioResult.mp3_path,
    audioResult.duration_sec
  );

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n" + "=".repeat(50));
  console.log("TACP COMPLETE");
  console.log("=".repeat(50));
  console.log(`Video:      ${videoPath}`);
  console.log(`Total time: ${elapsed} minutes`);
}

run().catch((err) => {
  console.error("\nTACP failed:", err.message ?? err);
  process.exit(1);
});