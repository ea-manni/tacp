import * as fs from "fs";
import * as path from "path";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const MODEL = "@cf/black-forest-labs/flux-1-schnell";

export class NsfwError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NsfwError";
  }
}

export async function generateStill(
  prompt: string,
  storyId: string,
  segmentIndex: number,
  aspectRatio: string = "9:16"
): Promise<string> {
  console.log(`[imageGen] Segment ${segmentIndex}: submitting to Cloudflare Workers AI...`);

  const width  = aspectRatio === "16:9" ? 1216 : 832;
  const height = aspectRatio === "16:9" ? 832  : 1216;
  console.log(`[imageGen] DEBUG: aspectRatio="${aspectRatio}" → ${width}x${height}`);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        num_steps: 8,
        width,
        height,
      }),
    }
  );

  const bodyText = await res.text();
  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Cloudflare AI failed ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  // Check for NSFW error (code 3030) before any other error handling
  if (Array.isArray(json.errors)) {
    const nsfwErr = json.errors.find((e: any) => e.code === 3030);
    if (nsfwErr) {
      throw new NsfwError(`Cloudflare AI NSFW (3030) on segment ${segmentIndex}: ${nsfwErr.message}`);
    }
  }

  if (!res.ok || json.success === false) {
    throw new Error(`Cloudflare AI failed ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  // Response is JSON: { result: { image: "<base64>" } }
  const buffer = Buffer.from(json.result.image, "base64");

  const dir = path.join("output", "stills", storyId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${segmentIndex}.jpg`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[imageGen] Saved -> ${filePath}`);
  return filePath;
}