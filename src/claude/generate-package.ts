import Anthropic from "@anthropic-ai/sdk";
import { MASTER_PROMPT, CUSTOM_STORY_PROMPT } from "./master-prompt.js";
import type { VideoPackage } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use Sonnet for reliability on complex JSON schemas.
// Swap to claude-haiku-4-5-20251001 if speed/cost is priority.
const MODEL = "claude-sonnet-4-6";

export async function generatePackage(
  storyIdea: string,
  customNarration?: string
): Promise<VideoPackage> {
  const systemPrompt = customNarration ? CUSTOM_STORY_PROMPT : MASTER_PROMPT;

  const userMessage = customNarration
    ? `Here is the narration to produce:\n\n${customNarration}`
    : storyIdea;

  const mode = customNarration
    ? "[Claude] Building package from custom narration..."
    : `[Claude] Generating story from idea: ${storyIdea}`;

  console.log(`\n${mode}`);
  console.log(`   Model: ${MODEL}`);

  let raw: string;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    raw = (message.content[0] as { text: string }).text.trim();
  } catch (err) {
    throw new Error(`Claude API call failed: ${err}`);
  }

  // Strip any accidental markdown fences Claude might add
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let pkg: VideoPackage;

  try {
    pkg = JSON.parse(cleaned) as VideoPackage;
  } catch {
    console.error("[Claude] Raw output that failed to parse:");
    console.error(cleaned.slice(0, 500));
    throw new Error("Claude returned invalid JSON — check the raw output above.");
  }

  // Validate required fields
  if (!pkg.story_id) throw new Error("Package missing story_id");
  if (!pkg.segments?.length) throw new Error("Package missing segments");
  if (!pkg.narration?.full_text) throw new Error("Package missing narration.full_text");

  // Save to disk
  const packagesDir = path.join("output", "packages");
  fs.mkdirSync(packagesDir, { recursive: true });
  const outputPath = path.join(packagesDir, `${pkg.story_id}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(pkg, null, 2));

  console.log(`   Story ID: ${pkg.story_id}`);
  console.log(`   Segments: ${pkg.segments.length}`);
  console.log(`   Title options: ${pkg.meta?.title_options?.length ?? 0}`);
  console.log(`[Claude] Package saved -> ${outputPath}`);

  return pkg;
}