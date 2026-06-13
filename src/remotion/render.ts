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
  console.log("\n[remotion] Starting render...");

  // Audio as data URI (no public folder, no staticFile)
  const audioBuffer = fs.readFileSync(audioPath);
  const audioSrc = `data:audio/wav;base64,${audioBuffer.toString("base64")}`;

  // Stills as data URIs - use preloaded if provided, else read from disk
  const segmentImages: Record<number, string> = { ...preloadedImages };
  for (const seg of pkg.segments) {
    if (segmentImages[seg.index]) continue;
    const stillPath = path.join("output", "stills", storyId, `${seg.index}.jpg`);
    if (fs.existsSync(stillPath)) {
      const b64 = fs.readFileSync(stillPath).toString("base64");
      segmentImages[seg.index] = `data:image/jpeg;base64,${b64}`;
      console.log(`[remotion] Still ${seg.index} loaded from disk`);
    } else {
      console.error(`[remotion] Still ${seg.index} NOT FOUND at ${stillPath}`);
    }
  }

  // Frame allocation
  const rawAudioSec = getWavDurationSec(audioPath);
  const playedAudioSec = rawAudioSec / AUDIO_SPEEDUP;
  const totalFrames = Math.round(playedAudioSec * FPS);
  const segmentFrames = segmentDurations.map((d) =>
    Math.round((d / AUDIO_SPEEDUP) * FPS)
  );
  const drift = totalFrames - segmentFrames.reduce((a, b) => a + b, 0);
  segmentFrames[segmentFrames.length - 1] += drift;
  console.log(`[remotion] Total frames: ${totalFrames} | Audio: ${playedAudioSec.toFixed(1)}s`);

  // Bundle
  const bundled = await bundle({
    entryPoint: path.resolve(process.cwd(), "src/index.ts"),
  });

  const inputProps = {
    segments: pkg.segments,
    narration: pkg.narration,
    storyId,
    segmentFrames,
    segmentImages,
    audioSrc,
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "ToledotVideo",
    inputProps,
  });

  const outputPath = path.join("output", "videos", `${storyId}.mp4`);
  fs.mkdirSync(path.join("output", "videos"), { recursive: true });

  await renderMedia({
    composition: { ...composition, durationInFrames: totalFrames, fps: FPS },
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    chromiumOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 20 === 0) console.log(`[remotion] Progress: ${pct}%`);
    },
  });

  return outputPath;
}