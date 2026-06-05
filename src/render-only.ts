import * as fs from "fs";
import * as path from "path";
import { renderVideo } from "./remotion/render.js";
import "dotenv/config";

async function run() {
  const storyId = process.argv[2];
  if (!storyId) {
    console.error('Usage: npx tsx src/render-only.ts <story_id>');
    process.exit(1);
  }

  const pkgPath = path.join("output", "packages", `${storyId}.json`);
  const audioPath = path.join("output", "audio", `${storyId}.wav`);

  if (!fs.existsSync(pkgPath)) throw new Error(`Package not found: ${pkgPath}`);
  if (!fs.existsSync(audioPath)) throw new Error(`Audio not found: ${audioPath}`);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  // Estimate duration from segments
  const duration = pkg.segments.reduce((sum: number, s: any) => sum + (s.duration_sec || 6), 0);

  console.log(`\n🎬 Rendering ${storyId}...`);
  const videoPath = await renderVideo(pkg, storyId, audioPath, duration);
  console.log(`\n✅ Done: ${videoPath}`);
}

run().catch((err) => {
  console.error("\n❌ Render failed:", err.message);
  console.error(err);
  process.exit(1);
});
