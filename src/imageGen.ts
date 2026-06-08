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
  segmentIndex: number
): Promise<string> {
  console.log(`[imageGen] Segment ${segmentIndex}: submitting to Cloudflare Workers AI...`);

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
        width: 832,
        height: 1216,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare AI failed ${res.status}: ${body.slice(0, 200)}`);
  }

  // Response is raw image bytes (JPEG/PNG)
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const dir = path.join("output", "stills", storyId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${segmentIndex}.jpg`);
  fs.writeFileSync(filePath, buffer);

  console.log(`[imageGen] Saved -> ${filePath}`);
  return filePath;
}