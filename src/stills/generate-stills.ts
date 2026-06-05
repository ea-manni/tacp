import { generateStill } from "../imageGen.js";
import type { VideoPackage } from "../types.js";
import * as fs from "fs";
import * as path from "path";

export async function generateStills(
  pkg: VideoPackage,
  storyId: string
): Promise<void> {
  console.log(`\n[stills] Generating ${pkg.segments.length} stills...`);

  for (const segment of pkg.segments) {
    const filePath = path.join("output", "stills", storyId, `${segment.index}.jpg`);

    if (fs.existsSync(filePath)) {
      console.log(`  [${segment.index}] Already exists — skipping`);
      continue;
    }

    await generateStill(segment.video_prompt, storyId, segment.index);
  }

  console.log(`[stills] Done.`);
}