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
}

function pcmToWav(pcmBuffer: Buffer<ArrayBuffer>, sampleRate: number): Buffer<ArrayBuffer> {
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
  console.log("\n🔊 Starting Gemini TTS synthesis...");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in .env");

  const ai = new GoogleGenAI({ apiKey });

  const { voice_name, tone_instruction } = await selectVoice(pkg);

  const promptedText = pkg.narration.full_text;

  console.log("   Calling Gemini TTS...");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text: promptedText }] }],
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
    finalBuffer = pcmToWav(Buffer.from(audioBuffer), 24000);
    console.log("   Converted PCM → WAV");
  }

  const wavPath = path.join(audioDir, `${storyId}.wav`);
  fs.writeFileSync(wavPath, finalBuffer);

  const dataSizeBytes = finalBuffer.length - 44;
  const duration = dataSizeBytes / (24000 * 1 * 2);

  console.log(`   ✅ Audio saved to ${wavPath}`);
 console.log(`   ⏱️  Duration: ${duration.toFixed(1)}s (target: 45–60s)`);

  if (duration < 30 || duration > 90) {
    console.warn(`   ⚠️  Duration outside 30–90s range. Consider adjusting script length.`);
  }

  return {
    mp3_path: wavPath,
    duration_sec: duration,
    voice_name,
  };
}

if (process.argv[1].endsWith("synthesize.ts")) {
  const pkgPath = process.argv[2];
  if (!pkgPath) {
    console.error(
      'Usage: npx tsx src/tts/synthesize.ts "output/packages/<story_id>.json"'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(pkgPath, "utf-8");
  const pkg: VideoPackage = JSON.parse(raw);
  const storyId = (pkg as any).story_id || path.basename(pkgPath, ".json");

  synthesize(pkg, storyId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}