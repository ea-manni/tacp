import * as fs from "fs";
import * as path from "path";
import { selectVoice } from "./select-voice.js";
import type { VideoPackage } from "../types.js";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

export interface AudioResult {
  mp3_path: string;
  duration_sec: number;
  voice_name: string;
  segment_durations: number[];
}

function pcmToWav(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function getWavDurationSec(wavBuffer: Buffer): number {
  const sampleRate = wavBuffer.readUInt32LE(24);
  const numChannels = wavBuffer.readUInt16LE(22);
  const bitsPerSample = wavBuffer.readUInt16LE(34);
  const dataSize = wavBuffer.length - 44;
  return dataSize / (sampleRate * numChannels * (bitsPerSample / 8));
}

async function synthesizeText(
  text: string,
  voiceName: string,
  ai: GoogleGenAI
): Promise<Buffer> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.[0];
  if (!audioPart?.inlineData?.data) {
    throw new Error(`No audio returned for: "${text.slice(0, 50)}"`);
  }

  const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
  const mimeType = audioPart.inlineData.mimeType ?? "audio/wav";

  if (mimeType.includes("L16") || mimeType.includes("pcm")) {
    return pcmToWav(audioBuffer, 24000);
  }
  return audioBuffer;
}

export async function synthesize(
  pkg: VideoPackage,
  storyId: string
): Promise<AudioResult> {
  console.log("\n[tts] Per-segment synthesis starting...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });
  const { voice_name } = await selectVoice(pkg);

  const audioDir = path.join("output", "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const segmentDurations: number[] = [];
  const pcmChunks: Buffer[] = [];

  for (const segment of pkg.segments) {
    console.log(`   [seg ${segment.index}] Synthesizing...`);
    const wavBuffer = await synthesizeText(segment.narration_text, voice_name, ai);
    const duration = getWavDurationSec(wavBuffer);
    segmentDurations.push(duration);
    pcmChunks.push(wavBuffer.slice(44)); // strip WAV header, keep PCM
    console.log(`   [seg ${segment.index}] ${duration.toFixed(2)}s`);
  }

  // Combine all PCM chunks into one WAV file
  const combinedPcm = Buffer.concat(pcmChunks);
  const finalWav = pcmToWav(combinedPcm, 24000);
  const totalDuration = segmentDurations.reduce((a, b) => a + b, 0);

  const wavPath = path.join(audioDir, `${storyId}.wav`);
  fs.writeFileSync(wavPath, finalWav);

  console.log(`   [tts] Done. ${totalDuration.toFixed(1)}s total across ${pkg.segments.length} segments`);
  console.log(`   Durations: ${segmentDurations.map((d) => d.toFixed(2) + "s").join(", ")}`);

  return {
    mp3_path: wavPath,
    duration_sec: totalDuration,
    voice_name,
    segment_durations: segmentDurations,
  };
}