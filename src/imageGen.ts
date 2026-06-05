import fs from "fs";
import path from "path";

const HORDE_API = "https://aihorde.net/api/v2";
const ANON_KEY = process.env.HORDE_API_KEY;
const CLIENT = "TACP:1.0:toledotstories";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitJob(prompt: string): Promise<string> {
  const res = await fetch(`${HORDE_API}/generate/async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      "Client-Agent": CLIENT,
    },
    body: JSON.stringify({
      prompt,
      params: {
        width: 512,
        height: 512,
        steps: 20,
        cfg_scale: 7,
        n: 1,
        sampler_name: "k_euler_a",
        // TODO: upgrade to 832x1216 after registering at stablehorde.net
        // width: 832,
        // height: 1216,
        // steps: 25,
      },
      r2: false,
      shared: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Submit failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function pollUntilDone(jobId: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const res = await fetch(`${HORDE_API}/generate/check/${jobId}`, {
      headers: { "Client-Agent": CLIENT },
    });
    if (!res.ok) throw new Error(`Check failed ${res.status}`);
    const data = (await res.json()) as {
      done: boolean;
      wait_time: number;
      faulted: boolean;
    };
    if (data.faulted) throw new Error("Job faulted on AI Horde");
    if (data.done) return;
    console.log(`  Waiting... (~${data.wait_time}s remaining)`);
  }
  throw new Error("Timeout — AI Horde took too long");
}

async function fetchResult(jobId: string): Promise<string> {
  const res = await fetch(`${HORDE_API}/generate/status/${jobId}`, {
    headers: { "Client-Agent": CLIENT },
  });
  if (!res.ok) throw new Error(`Status failed ${res.status}`);
  const data = (await res.json()) as {
    generations: { img: string }[];
    faulted: boolean;
  };
  if (data.faulted || !data.generations?.length) {
    throw new Error("No image returned");
  }
  return data.generations[0].img;
}

export async function generateStill(
  prompt: string,
  storyId: string,
  segmentIndex: number,
): Promise<string> {
  console.log(`[imageGen] Segment ${segmentIndex}: submitting to AI Horde...`);

  const jobId = await submitJob(prompt);
  console.log(`[imageGen] Job ${jobId} — polling every 5s...`);

  await pollUntilDone(jobId);

  const b64 = await fetchResult(jobId);

  const dir = path.join("public", "stills", storyId);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${segmentIndex}.jpg`);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));

  console.log(`[imageGen] Saved → ${filePath}`);
  return filePath;
}
