import Anthropic from "@anthropic-ai/sdk";
import { buildMasterPrompt, buildByotMetaPrompt } from "./master-prompt.js";
import type { VideoPackage, Segment } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-4-5";
const SEGMENT_SECONDS = 9;
const WPM = 140;
// ~21 words per 9-second segment at 140wpm
const WORDS_PER_SEGMENT = Math.round((SEGMENT_SECONDS * WPM) / 60);

interface ByotMetaResponse {
  story_id: string;
  meta: VideoPackage["meta"];
  segment_visuals: Array<{
    index: number;
    video_prompt: string;
    visual_style: Segment["visual_style"];
    motion: Segment["motion"];
    transition_in: Segment["transition_in"];
    overlay?: Segment["overlay"];
  }>;
}

// Split narration into ~WORDS_PER_SEGMENT-word chunks at sentence boundaries.
function splitNarrationIntoSegments(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const segments: string[] = [];
  let buffer = "";
  let bufferWords = 0;

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const words = s.split(/\s+/).length;

    if (bufferWords >= WORDS_PER_SEGMENT && buffer) {
      segments.push(buffer);
      buffer = s;
      bufferWords = words;
    } else {
      buffer = buffer ? `${buffer} ${s}` : s;
      bufferWords += words;
    }
  }

  if (buffer) segments.push(buffer);
  return segments;
}

function stripFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function savePackage(pkg: VideoPackage, wordCount: number): string {
  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });
  const outputPath = path.join(packagesDir, `${pkg.story_id}_w${wordCount}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(pkg, null, 2));
  return outputPath;
}

export async function generatePackage(
  storyIdea: string,
  customNarration?: string,
  targetWordCount: number = 117,
): Promise<VideoPackage> {
  if (customNarration) {
    return generateByotPackage(customNarration);
  }

  console.log(`\n[Claude] Generating story from idea: ${storyIdea}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Target words: ${targetWordCount}`);

  let raw: string;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: buildMasterPrompt(targetWordCount),
      messages: [{ role: "user", content: storyIdea }],
    });
    raw = (message.content[0] as { text: string }).text.trim();
  } catch (err) {
    throw new Error(`Claude API call failed: ${err}`);
  }

  let pkg: VideoPackage;
  try {
    pkg = JSON.parse(stripFences(raw)) as VideoPackage;
  } catch {
    console.error("[Claude] Raw output that failed to parse:");
    console.error(raw.slice(0, 500));
    throw new Error("Claude returned invalid JSON — check the raw output above.");
  }

  if (!pkg.story_id) throw new Error("Package missing story_id");
  if (!pkg.segments?.length) throw new Error("Package missing segments");
  if (!pkg.narration?.full_text) throw new Error("Package missing narration.full_text");

  const outputPath = savePackage(pkg, targetWordCount);
  console.log(`   Story ID: ${pkg.story_id}`);
  console.log(`   Segments: ${pkg.segments.length}`);
  console.log(`   Title options: ${pkg.meta?.title_options?.length ?? 0}`);
  console.log(`[Claude] Package saved -> ${outputPath}`);

  return pkg;
}

async function generateByotPackage(customNarration: string): Promise<VideoPackage> {
  const text = customNarration.trim();
  const totalWords = text.split(/\s+/).length;
  const estimatedDurationSec = Math.round((totalWords / WPM) * 60);
  const narrationSegments = splitNarrationIntoSegments(text);

  console.log(`\n[Claude] BYOT package — narration split in code, Claude generates metadata only`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Words: ${totalWords} → ~${estimatedDurationSec}s`);
  console.log(`   Segments: ${narrationSegments.length} (~${WORDS_PER_SEGMENT} words each)`);

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildByotMetaPrompt(narrationSegments, estimatedDurationSec),
      messages: [{ role: "user", content: "Generate production metadata and visual direction for these segments." }],
    });
    raw = (message.content[0] as { text: string }).text.trim();
  } catch (err) {
    throw new Error(`Claude API call failed: ${err}`);
  }

  let metaResponse: ByotMetaResponse;
  try {
    metaResponse = JSON.parse(stripFences(raw)) as ByotMetaResponse;
  } catch {
    console.error("[Claude] Raw output that failed to parse:");
    console.error(raw.slice(0, 500));
    throw new Error("Claude returned invalid JSON — check the raw output above.");
  }

  const pkg: VideoPackage = {
    story_id: metaResponse.story_id,
    meta: metaResponse.meta,
    narration: {
      full_text: text,
      voice_id: "21m00Tcm4TlvDq8ikWAM",
      estimated_duration_sec: estimatedDurationSec,
    },
    segments: narrationSegments.map((segText, i) => {
      const visual = metaResponse.segment_visuals?.[i] ?? {
        index: i,
        video_prompt: "Cinematic historical scene, wide establishing shot, natural light.",
        visual_style: "wide" as const,
        motion: "slow_pan" as const,
        transition_in: "cut" as const,
      };
      const segWords = segText.split(/\s+/).length;
      const seg: Segment = {
        index: i,
        narration_text: segText,
        duration_sec: Math.round((segWords / WPM) * 60) as Segment["duration_sec"],
        video_prompt: visual.video_prompt,
        visual_style: visual.visual_style,
        motion: visual.motion,
        transition_in: visual.transition_in,
      };
      if (visual.overlay) seg.overlay = visual.overlay;
      return seg;
    }),
  };

  if (!pkg.story_id) throw new Error("Package missing story_id");
  if (!pkg.segments?.length) throw new Error("Package missing segments");

  const outputPath = savePackage(pkg, totalWords);
  console.log(`   Story ID: ${pkg.story_id}`);
  console.log(`   Segments: ${pkg.segments.length}`);
  console.log(`   Title options: ${pkg.meta?.title_options?.length ?? 0}`);
  console.log(`[Claude] Package saved -> ${outputPath}`);

  return pkg;
}
