import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import * as fs from "fs";
import * as path from "path";
import type { VideoPackage } from "../types.js";
import "dotenv/config";

const FPS = 30;
const AUDIO_SPEEDUP = 1.15;

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
  _duration: number,
  segmentDurations: number[],
  preloadedImages: Record<number, string> = {}
): Promise<string> {
  console.log("\nStarting Remotion render...");

  // Step 1: Copy audio to public folder
  const publicAudioDir = path.join("public", "audio");
  fs.mkdirSync(publicAudioDir, { recursive: true });
  const publicAudioPath = path.join(publicAudioDir, `${storyId}.wav`);
  fs.copyFileSync(audioPath, publicAudioPath);
  console.log("   Audio copied to public/");

  // Step 2: Read stills as base64 data URIs
  const segmentImages: Record<number, string> = {};
  for (const seg of pkg.segments) {
    const stillPath = path.join("output", "stills", storyId, `${seg.index}.jpg`);
    if (fs.existsSync(stillPath)) {
      const b64 = fs.readFileSync(stillPath).toString("base64");
      segmentImages[seg.index] = `data:image/jpeg;base64,${b64}`;
      console.log(`   Still ${seg.index}: loaded as base64`);
    } else {
      console.error(`   Still ${seg.index}: NOT FOUND at ${stillPath}`);
    }
  }

  // Step 3: Compute frame allocations
  const rawAudioSec = getWavDurationSec(audioPath);
  const playedAudioSec = rawAudioSec / AUDIO_SPEEDUP;
  const totalFrames = Math.round(playedAudioSec * FPS);
  console.log(`   Audio: ${rawAudioSec.toFixed(1)}s raw -> ${playedAudioSec.toFixed(1)}s @ ${AUDIO_SPEEDUP}x`);
  console.log(`   Total video: ${totalFrames} frames (${(totalFrames / FPS).toFixed(1)}s)`);

  const segmentFrames = segmentDurations.map((d) =>
    Math.round((d / AUDIO_SPEEDUP) * FPS)
  );
  const drift = totalFrames - segmentFrames.reduce((a, b) => a + b, 0);
  segmentFrames[segmentFrames.length - 1] += drift;

  pkg.segments.forEach((s, i) => {
    console.log(`      Seg ${s.index}: ${segmentFrames[i]} frames (${(segmentFrames[i] / FPS).toFixed(1)}s)`);
  });

  // Step 4: Bundle Remotion
  console.log("   Bundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    publicDir: path.resolve(process.cwd(), "public"),
    webpackOverride: (config) => config,
  });

  // Step 5: Select composition
  const inputProps = {
    segments: pkg.segments,
    narration: pkg.narration,
    storyId,
    segmentFrames,
    segmentImages,
  };

  const composition = await selectComposition({
    timeoutInMilliseconds: 120000,
    serveUrl: bundled,
    id: "ToledotVideo",
    inputProps,
  });

  // Step 6: Render
  console.log(`   Rendering ${totalFrames} frames at ${FPS}fps...`);
  const outputPath = path.join("output", "videos", `${storyId}.mp4`);
  fs.mkdirSync(path.join("output", "videos"), { recursive: true });

  await renderMedia({
    chromiumOptions: {
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
    timeoutInMilliseconds: 120000,
    composition: { ...composition, durationInFrames: totalFrames, fps: FPS },
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0) console.log(`   Render progress: ${pct}%`);
    },
  });

  console.log(`   Video saved to ${outputPath}`);
  return outputPath;
}