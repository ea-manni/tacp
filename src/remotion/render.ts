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
  segmentDurations: number[]
): Promise<string> {
  console.log("\n[remotion] Starting render...");

  const publicAudioDir = path.join("public", "audio");
  fs.mkdirSync(publicAudioDir, { recursive: true });
  const publicAudioPath = path.join(publicAudioDir, `${storyId}.wav`);
  fs.copyFileSync(audioPath, publicAudioPath);

  const rawAudioSec = getWavDurationSec(audioPath);
  const playedAudioSec = rawAudioSec / AUDIO_SPEEDUP;
  const totalFrames = Math.round(playedAudioSec * FPS);

  const segmentFrames = segmentDurations.map(d => 
    Math.round((d / AUDIO_SPEEDUP) * FPS)
  );
  const drift = totalFrames - segmentFrames.reduce((a, b) => a + b, 0);
  segmentFrames[segmentFrames.length - 1] += drift;

  console.log(`[remotion] Total frames: ${totalFrames} | Audio: ${playedAudioSec.toFixed(1)}s`);

  const bundled = await bundle({
    entryPoint: path.resolve(process.cwd(), "src/index.ts"),
    publicDir: path.resolve(process.cwd(), "public"),
  });

  const inputProps = {
    segments: pkg.segments,
    narration: pkg.narration,
    storyId,
    segmentFrames,
    // Still images will be loaded inside Remotion via storyId + index
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
    chromiumOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 20 === 0) {
        console.log(`[remotion] Progress: ${Math.round(progress * 100)}%`);
      }
    },
  });

  return outputPath;
}