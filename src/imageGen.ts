import * as fs from "fs";
import * as path from "path";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare AI failed ${res.status}: ${body.slice(0, 200)}`);
  }

  // Response is JSON: { result: { image: "<base64>" } }
const json = await res.json() as { result: { image: string } };
const buffer = Buffer.from(json.result.image, "base64");

  const dir = path.join("output", "stills", storyId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${segmentIndex}.jpg`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[imageGen] Saved -> ${filePath}`);
  return filePath;
}