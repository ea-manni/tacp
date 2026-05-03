// Calls the Anthropic API with the master prompt + a story idea.
// Returns a parsed VideoPackage JSON.

import Anthropic from "@anthropic-ai/sdk";
import { MASTER_PROMPT } from "./master-prompt.js";
import type { VideoPackage } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generatePackage(storyIdea: string): Promise<VideoPackage> {
  console.log("📝 Calling Claude with story idea:", storyIdea);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8000,
    system: MASTER_PROMPT,
    messages: [{ role: "user", content: storyIdea }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let raw = textBlock.text.trim();
  // strip code fences if Claude added them despite instructions
  raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  let pkg: VideoPackage;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to parse JSON. Raw output:");
    console.error(raw);
    throw err;
  }

 // save to disk — handle both story_id and story_title as the identifier
  const storyId = (pkg as any).story_id || 
    (pkg as any).story_title?.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50) || 
    "unknown_story";
  
  const outPath = path.join("output", "packages", `${storyId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2));
  console.log(`✅ Saved package to ${outPath}`);
  console.log(`   Segments: ${pkg.segments.length}`);

  // title_options may be at top level or nested under meta
  const titleOptions = (pkg as any).title_options || pkg.meta?.title_options;
  console.log(`   Title options: ${titleOptions?.length ?? 0}`);


  return pkg;
}

// allow running this file directly: `npx tsx src/claude/generate-package.ts "story idea"`
if (process.argv[1].endsWith("generate-package.ts")) {
  const storyIdea = process.argv[2];
  if (!storyIdea) {
    console.error("Usage: npx tsx src/claude/generate-package.ts \"<story idea>\"");
    process.exit(1);
  }
  generatePackage(storyIdea).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}