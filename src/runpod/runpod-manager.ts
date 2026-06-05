import "dotenv/config";

const RUNPOD_API = "https://rest.runpod.io/v1";
const SERVER_PORT = 8080;
const STARTUP_TIMEOUT_MS = 1800000; // 30 minutes
const POLL_INTERVAL_MS = 10000;     // poll every 10 seconds

// RunPod network volume — tacp-models in EU-RO-1
// Wan2.2-TI2V-5B lives at /workspace/wan22-ti2v-5b inside the container
const NETWORK_VOLUME_ID = "anoteh7qk3"; // update with actual RunPod volume ID after first deploy
const DATACENTER_ID = "EU-RO-1";
const GPU_TYPE_ID = "NVIDIA GeForce RTX 4090";

export interface RunPodInstance {
  id: string;
  baseUrl: string;
}

// ── API helper ────────────────────────────────────────────────────────────────
async function runpodRequest(
  method: string,
  endpoint: string,
  body?: any
): Promise<any> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY not set in .env");

  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(`${RUNPOD_API}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`RunPod API error ${res.status}: ${err}`);
      }

      return res.json();
    } catch (err: any) {
      retries--;
      if (retries === 0) throw err;
      console.log(`   ⚠️  API request failed, retrying... (${err.message})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ── Launch pod ────────────────────────────────────────────────────────────────
export async function launchPod(): Promise<string> {
  console.log("   🚀 Launching RunPod GPU instance...");
  console.log(`   📦 Volume: ${NETWORK_VOLUME_ID} | DC: ${DATACENTER_ID}`);

  const data = await runpodRequest("POST", "/pods", {
    name: "tacp-worker",
    imageName: "eolowo/tacp-ltx:latest",
    gpuTypeIds: [GPU_TYPE_ID],
    cloudType: "SECURE",
    dataCenterIds: [DATACENTER_ID],
    networkVolumeId: NETWORK_VOLUME_ID,
    containerDiskInGb: 20,
    ports: [`${SERVER_PORT}/http`],
    // Model is on the network volume — just start uvicorn
    dockerStartCmd: ["uvicorn", "tacp_server:app", "--host", "0.0.0.0", "--port", `${SERVER_PORT}`, "--app-dir", "/workspace"],
  });

  const podId = data?.id;
  if (!podId) throw new Error(`No pod ID returned: ${JSON.stringify(data)}`);

  console.log(`   ✅ Pod launched: ID ${podId}`);
  return podId;
}

// ── Wait for pod ready ────────────────────────────────────────────────────────
export async function waitForReady(podId: string): Promise<RunPodInstance> {
  console.log("   ⏳ Waiting for pod to be ready...");
  console.log("   (Docker pull + model load — may take 5–15 min)");

  const start = Date.now();

  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let data: any;
    try {
      data = await runpodRequest("GET", `/pods/${podId}`);
    } catch {
      console.log("   ⚠️  Poll failed — retrying...");
      continue;
    }

    const status = data?.desiredStatus ?? data?.status;
    const runtime = data?.runtime;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`   [${elapsed}s] Status: ${status}`);

    if (status === "RUNNING" && runtime) {
      // RunPod exposes HTTP ports via a proxy URL
      // Format: https://{podId}-{port}.proxy.runpod.net
      const baseUrl = `https://${podId}-${SERVER_PORT}.proxy.runpod.net`;
      console.log(`   🔌 Pod URL: ${baseUrl}`);

      const healthy = await waitForHealth(baseUrl);
      if (healthy) {
        console.log(`\n   ✅ Pod ready! URL: ${baseUrl}`);
        return { id: podId, baseUrl };
      }

      // Health check failed — pod might still be starting
      console.log("   ⚠️  Health check failed, continuing to wait...");
      continue;
    }

    if (["EXITED", "FAILED", "TERMINATED"].includes(status)) {
      throw new Error(`Pod ${podId} failed with status: ${status}`);
    }
  }

  throw new Error("Pod startup timed out after 30 minutes");
}

// ── Health check ──────────────────────────────────────────────────────────────
async function waitForHealth(baseUrl: string): Promise<boolean> {
  console.log(`   ⏳ Checking server health at ${baseUrl}...`);

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10000));

    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data: any = await res.json();
        console.log(`   ✅ Server healthy — GPU: ${data.gpu} | VRAM: ${data.vram_gb}GB`);

        if (data.model_error) {
          console.log(`   ❌ Model load error: ${data.model_error}`);
          return false;
        }

        if (data.model_loaded) {
          console.log(`   ✅ Model loaded and ready`);
          return true;
        }

        const loadTime = data.loading_elapsed_sec ?? "?";
        console.log(`   ⏳ Model loading... (${loadTime}s elapsed)`);
        continue;
      }
    } catch {
      const elapsed = Math.round((i + 1) * 10);
      console.log(`   ⏳ [${elapsed}s] Server not ready yet...`);
    }
  }

  return false;
}

// ── Terminate pod ─────────────────────────────────────────────────────────────
export async function terminatePod(podId: string): Promise<void> {
  console.log(`   🗑️  Terminating pod ${podId}...`);
  try {
    await runpodRequest("DELETE", `/pods/${podId}`);
    console.log("   ✅ Pod terminated");
  } catch (err: any) {
    console.warn(`   ⚠️  Could not terminate pod: ${err.message}`);
  }
}

// ── Terminate all pods ────────────────────────────────────────────────────────
export async function terminateAllPods(): Promise<void> {
  console.log("🗑️  Checking for running pods...");

  const data = await runpodRequest("GET", "/pods");
  const pods = data?.pods ?? data ?? [];

  if (pods.length === 0) {
    console.log("   ✅ No running pods found");
    return;
  }

  console.log(`   Found ${pods.length} pod(s) — terminating all...`);
  for (const pod of pods) {
    await terminatePod(pod.id);
  }
  console.log("   ✅ All pods terminated");
}

// ── Spin up and get URL (used by orchestrator) ────────────────────────────────
export async function spinUpAndGetUrl(): Promise<RunPodInstance> {
  console.log("\n🖥️  Spinning up RunPod GPU instance...");
  const podId = await launchPod();
  return await waitForReady(podId);
}