// Claude reads the story JSON and picks the best Gemini voice.

import Anthropic from "@anthropic-ai/sdk";
import { VOICE_SELECTOR_PROMPT } from "./voices.js";
import type { VideoPackage } from "../types.js";
import "dotenv/config";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface VoiceSelection {
  voice_name: string;
  tone_instruction: string;
  reasoning: string;
}

export async function selectVoice(pkg: VideoPackage): Promise<VoiceSelection> {
  const storyId = (pkg as any).story_id ?? "unknown";
  console.log("🎙️  Selecting voice for:", storyId);

  const storyContext = {
    story_id: storyId,
    title_options: pkg.meta?.title_options ?? (pkg as any).title_options,
    narration_opening: pkg.narration.full_text.slice(0, 300),
    pinned_comment: pkg.meta?.pinned_comment ?? (pkg as any).pinned_comment,
  };

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 300,
    system: VOICE_SELECTOR_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(storyContext) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No voice selection response from Claude");
  }

  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  const selection: VoiceSelection = JSON.parse(raw);
  console.log(`   ✅ Voice: ${selection.voice_name}`);
  console.log(`   🎬 Tone: ${selection.tone_instruction}`);
  console.log(`   💬 Reason: ${selection.reasoning}`);

  return selection;
}