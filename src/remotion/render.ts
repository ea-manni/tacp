import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import * as fs from "fs";
import * as path from "path";
import type { VideoPackage } from "../types.js";
import "dotenv/config";

const FPS = 30;
const AUDIO_SPEEDUP = 1.15;

// Read WAV duration from header (for 16-bit PCM mono WAVs from Gemini TTS)
function getWavDurationSec(wavPath: string): number {
  const buf = fs.readFileSync(wavPath);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const numChannels = buf.readUInt16LE(22);
  const dataSize = buf.length - 44;
  const bytesPerSample = bitsPerSample / 8;
  return dataSize / (sampleRate * numChannels * bytesPerSample);
}

export async function renderVideo(
  pkg: VideoPackage,
  storyId: string,
  audioPath: string,
  _duration: number
): Promise<string> {
  console.log("\n🎬 Starting Remotion render...");

  // Step 1: Copy assets to public folder
  console.log("   Copying assets to public folder...");
  const publicAudioDir = path.join("public", "audio");
  const publicClipsDir = path.join("public", "clips", storyId);
  fs.mkdirSync(publicAudioDir, { recursive: true });
  fs.mkdirSync(publicClipsDir, { recursive: true });

  const publicAudioPath = path.join(publicAudioDir, `${storyId}.wav`);
  fs.copyFileSync(audioPath, publicAudioPath);
  console.log(`   ✅ Audio copied`);

  const clipsDir = path.join("output", "clips", storyId);
  const clipFiles = fs.readdirSync(clipsDir).filter((f) => f.endsWith(".mp4"));
  clipFiles.forEach((file) => {
    fs.copyFileSync(
      path.join(clipsDir, file),
      path.join(publicClipsDir, file)
    );
  });
  console.log(`   ✅ ${clipFiles.length} clips copied`);

  // Step 2: Measure audio and compute per-segment frame allocations
  const rawAudioSec = getWavDurationSec(audioPath);
  const playedAudioSec = rawAudioSec / AUDIO_SPEEDUP; // audio sped up at playback
  const totalFrames = Math.round(playedAudioSec * FPS);

  console.log(`   ⏱️  Audio: ${rawAudioSec.toFixed(1)}s raw → ${playedAudioSec.toFixed(1)}s @ ${AUDIO_SPEEDUP}x`);
  console.log(`   📐 Total video: ${totalFrames} frames (${(totalFrames / FPS).toFixed(1)}s)`);

  // Distribute frames across segments by narration character count
  const charCounts = pkg.segments.map((s) => s.narration_text.length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0);

  const segmentFrames = charCounts.map((c) =>
    Math.round((c / totalChars) * totalFrames)
  );

  // Fix any rounding drift so they sum to totalFrames exactly
  const drift = totalFrames - segmentFrames.reduce((a, b) => a + b, 0);
  segmentFrames[segmentFrames.length - 1] += drift;

  pkg.segments.forEach((s, i) => {
    console.log(
      `      Seg ${s.index}: ${segmentFrames[i]} frames (${(segmentFrames[i] / FPS).toFixed(1)}s) — ${charCounts[i]} chars`
    );
  });

  // Step 3: Bundle Remotion
  console.log("   Bundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    webpackOverride: (config) => config,
  });

  // Step 4: Select composition
  const inputProps = {
    segments: pkg.segments,
    narration: pkg.narration,
    storyId,
    segmentFrames,
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "ToledotVideo",
    inputProps,
  });

  // Step 5: Render
  console.log(`   Rendering ${totalFrames} frames at ${FPS}fps...`);
  const outputPath = path.join("output", "videos", `${storyId}.mp4`);
  fs.mkdirSync(path.join("output", "videos"), { recursive: true });

  await renderMedia({
    composition: { ...composition, durationInFrames: totalFrames, fps: FPS },
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