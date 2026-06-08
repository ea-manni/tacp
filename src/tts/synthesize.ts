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

export async function synthesize(
  pkg: VideoPackage,
  storyId: string
): Promise<AudioResult> {
  console.log("\n[tts] Starting Gemini TTS synthesis...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const ai = new GoogleGenAI({ apiKey });
  const { voice_name } = await selectVoice(pkg);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text: pkg.narration.full_text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice_name },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.[0];
  if (!audioPart?.inlineData?.data) {
    throw new Error("No audio data returned from Gemini TTS");
  }

  const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
  const mimeType = audioPart.inlineData.mimeType ?? "audio/wav";

  const audioDir = path.join("output", "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  let finalBuffer = audioBuffer;
  if (mimeType.includes("L16") || mimeType.includes("pcm")) {
    finalBuffer = pcmToWav(audioBuffer, 24000);
  }

  const wavPath = path.join(audioDir, `${storyId}.wav`);
  fs.writeFileSync(wavPath, finalBuffer);

  const dataSizeBytes = finalBuffer.length - 44;
  const duration = dataSizeBytes / (24000 * 1 * 2);

  // Character-count based segment duration estimates
  const totalChars = pkg.segments.reduce((a, s) => a + s.narration_text.length, 0);
  const segmentDurations = pkg.segments.map((s) =>
    (s.narration_text.length / totalChars) * duration
  );

  console.log(`   [tts] Done. ${duration.toFixed(1)}s total`);

  return {
    mp3_path: wavPath,
    duration_sec: duration,
    voice_name,
    segment_durations: segmentDurations,
  };
}