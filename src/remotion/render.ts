import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import * as fs from "fs";
import * as path from "path";
import type { VideoPackage } from "../types.js";
import "dotenv/config";

export async function renderVideo(
  pkg: VideoPackage,
  storyId: string,
  audioPath: string,
  duration: number
): Promise<string> {
  console.log("\n🎬 Starting Remotion render...");

  // Step 1: Copy assets to public folder
  console.log("   Copying assets to public folder...");

  const publicAudioDir = path.join("public", "audio");
  const publicClipsDir = path.join("public", "clips", storyId);
  fs.mkdirSync(publicAudioDir, { recursive: true });
  fs.mkdirSync(publicClipsDir, { recursive: true });

  // Copy audio
  const publicAudioPath = path.join(publicAudioDir, `${storyId}.wav`);
  fs.copyFileSync(audioPath, publicAudioPath);
  console.log(`   ✅ Audio copied`);

  // Copy clips
  const clipsDir = path.join("output", "clips", storyId);
  const clipFiles = fs.readdirSync(clipsDir).filter((f) => f.endsWith(".mp4"));
  clipFiles.forEach((file) => {
    fs.copyFileSync(
      path.join(clipsDir, file),
      path.join(publicClipsDir, file)
    );
  });
  console.log(`   ✅ ${clipFiles.length} clips copied`);

  // Step 2: Calculate duration in frames
  const fps = 30;
  const durationInFrames = pkg.segments.length * 180; // 6s per clip at 30fps

  // Step 3: Bundle the Remotion project
  console.log("   Bundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    webpackOverride: (config) => config,
  });

  // Step 4: Select composition with props
  const inputProps = {
    segments: pkg.segments,
    narration: pkg.narration,
    storyId,
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "ToledotVideo",
    inputProps,
  });

  // Step 5: Render
  console.log(`   Rendering ${durationInFrames} frames at ${fps}fps...`);
  const outputPath = path.join("output", "videos", `${storyId}.mp4`);
  fs.mkdirSync(path.join("output", "videos"), { recursive: true });

  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0) console.log(`   ⏳ Render progress: ${pct}%`);
    },
  });

  console.log(`   ✅ Video saved to ${outputPath}`);
  return outputPath;
}