import "dotenv/config";

const VAST_API = "https://console.vast.ai/api/v0";
const SERVER_PORT = 8080;
const STARTUP_TIMEOUT_MS = 1800000; // 30 minutes
const POLL_INTERVAL_MS = 10000;     // poll every 10 seconds

// Volume name for model weights — must be created on Vast.ai first
// The volume stores Wan2.2-TI2V-5B at /root/.cache/wan22-ti2v-5b
const MODEL_VOLUME_NAME = "tacp-models";
const MODEL_VOLUME_ID = 36903537;
const MODEL_VOLUME_MOUNT = "/root/.cache";

export interface VastInstance {
  id: number;
  host: string;
  port: number;
  baseUrl: string;
}

// ── API helper ────────────────────────────────────────────────────────────────
async function vastRequest(method: string, endpoint: string, body?: any): Promise<any> {
  const apiKey = process.env.VASTAI_API_KEY;
  if (!apiKey) throw new Error("VASTAI_API_KEY not set in .env");

  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(`${VAST_API}${endpoint}`, {
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
        throw new Error(`Vast.ai API error ${res.status}: ${err}`);
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

// ── Find the model volume ─────────────────────────────────────────────────────
async function findModelVolume(): Promise<{ volume_id: number; machine_id: number } | null> {
  console.log(`   🔍 Looking for volume "${MODEL_VOLUME_NAME}"...`);

  const data = await vastRequest("GET", "/volumes/");
  const volumes = data.volumes ?? data ?? [];

  const vol = volumes.find((v: any) =>
    v.id === MODEL_VOLUME_ID || v.label === MODEL_VOLUME_NAME
  );

  if (!vol) return null;

  console.log(`   ✅ Found volume: ID ${vol.id} on machine ${vol.machine_id}`);
  return { volume_id: vol.id, machine_id: vol.machine_id };
}

// ── Find best offer ───────────────────────────────────────────────────────────
export async function findBestOffer(machineId?: number): Promise<number> {
  console.log("   🔍 Searching for best GPU offer...");

  const apiKey = process.env.VASTAI_API_KEY;
  if (!apiKey) throw new Error("VASTAI_API_KEY not set in .env");

  const ACCEPTED_GPUS = [
    "RTX 4090",
    "RTX 4080 SUPER",
    "RTX 4080",
    "L40S",
    "L40",
    "H100",
  ];

  const searchBody: any = {
    limit: 50,
    type: "on-demand",
    verified: { eq: true },
    rentable: { eq: true },
    rented: { eq: false },
    num_gpus: { eq: 1 },
    gpu_ram: { gte: 24000 },
    reliability2: { gte: 0.95 },
    cuda_max_good: { gte: 12.0 },
    disk_space: { gte: 40 },
    dph_total: { lte: 0.60 },
    order: [["dph_total", "asc"]],
  };

  // If we have a volume, restrict to that machine
  if (machineId) {
    searchBody.machine_id = { eq: machineId };
    console.log(`   📌 Filtering to machine ${machineId} (where volume lives)`);
  }

  const res = await fetch(`${VAST_API}/bundles/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(searchBody),
  });

  if (!res.ok) throw new Error(`Search error ${res.status}: ${await res.text()}`);

  const data = await res.json();

  if (!data.offers || data.offers.length === 0) {
    if (machineId) {
      throw new Error(`Volume machine ${machineId} is not available right now — the GPU may be rented by someone else. Try again later.`);
    }
    throw new Error("No GPU offers found — try again in a few minutes");
  }

  const valid = data.offers.filter((o: any) =>
    o.gpu_ram >= 24000 &&
    o.disk_space >= 40 &&
    o.reliability2 >= 0.95 &&
    o.cuda_max_good >= 12.0 &&
    o.rentable === true &&
    o.rented === false &&
    ACCEPTED_GPUS.some((name) => o.gpu_name?.includes(name))
  );

  if (valid.length === 0) {
    if (machineId) {
      throw new Error(`Volume machine ${machineId} has no accepted GPU available right now. Try again later.`);
    }
    throw new Error("No accepted GPUs available right now — try again in a few minutes");
  }

  const best = valid[0];
  console.log(`   ✅ Selected GPU: ${best.gpu_name}`);
  console.log(`      VRAM:        ${Math.round(best.gpu_ram / 1024)}GB`);
  console.log(`      Disk:        ${Math.round(best.disk_space)}GB available`);
  console.log(`      Cost:        $${best.dph_total.toFixed(3)}/hr`);
  console.log(`      Reliability: ${(best.reliability2 * 100).toFixed(1)}%`);
  console.log(`      CUDA:        ${best.cuda_max_good}`);
  console.log(`      Location:    ${best.geolocation}`);

  return best.id;
}

// ── Onstart script ────────────────────────────────────────────────────────────
const ONSTART_SCRIPT = `#!/bin/bash
set -e
echo "[TACP] Starting uvicorn..."
cd /workspace
nohup uvicorn tacp_server:app --host 0.0.0.0 --port 8080 --app-dir /workspace > /var/log/tacp.log 2>&1 &
echo "[TACP] Server starting in background (PID $!)"
`;

// ── Launch instance ───────────────────────────────────────────────────────────
export async function launchInstance(offerId: number, volumeId?: number): Promise<number> {
  console.log("   🚀 Launching GPU instance...");

  const body: any = {
    client_id: "me",
    image: "eolowo/tacp-ltx:latest",
    disk: 40,
    runtype: "ssh",
    python_utf8: true,
    extra: "-p 8080:8080",
    onstart: ONSTART_SCRIPT,
  };

  // Attach the model volume if available
  if (volumeId) {
    body.volume_info = {
      volume_id: volumeId,
      mount_path: MODEL_VOLUME_MOUNT,
    };
    console.log(`   📦 Attaching volume ${volumeId} at ${MODEL_VOLUME_MOUNT}`);
  }

  const data = await vastRequest("PUT", `/asks/${offerId}/`, body);

  const instanceId = data.new_contract;
  if (!instanceId) throw new Error(`No instance ID returned: ${JSON.stringify(data)}`);

  console.log(`   ✅ Instance launched: ID ${instanceId}`);
  return instanceId;
}

// ── Wait for ready ────────────────────────────────────────────────────────────
export async function waitForReady(instanceId: number): Promise<VastInstance> {
  console.log("   ⏳ Waiting for instance to be ready...");
  console.log("   (Docker pull + model load — may take 5–15 min)");

  const start = Date.now();

  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let data: any;
    try {
      data = await vastRequest("GET", `/instances/${instanceId}/`);
    } catch {
      console.log("   ⚠️  Poll failed — retrying...");
      continue;
    }

    const instance = data.instances?.[0];
    if (!instance) continue;

    const status = instance.actual_status;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`   [${elapsed}s] Status: ${status}`);

    if (status === "running") {
      const host = instance.ssh_host;
      if (!host) {
        console.log("   Waiting for host IP...");
        continue;
      }

      const externalPort =
        instance.ports?.["8080/tcp"]?.[0]?.HostPort ||
        instance.extra_env?.VAST_TCP_PORT_8080 ||
        SERVER_PORT;

      console.log(`   🔌 Host: ${host} | External port: ${externalPort}`);

      const baseUrl = `http://${host}:${externalPort}`;
      const healthy = await waitForHealth(baseUrl, instanceId);

      if (healthy) {
        console.log(`\n   ✅ Instance ready! URL: ${baseUrl}`);
        return {
          id: instanceId,
          host,
          port: instance.ssh_port,
          baseUrl,
        };
      }
    }

    if (status === "failed" || status === "error" || status === "exited") {
      throw new Error(`Instance ${instanceId} failed with status: ${status}`);
    }
  }

  throw new Error("Instance startup timed out after 30 minutes");
}

// ── Health check ──────────────────────────────────────────────────────────────
async function waitForHealth(baseUrl: string, instanceId: number): Promise<boolean> {
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

// ── Destroy instance ──────────────────────────────────────────────────────────
export async function destroyInstance(instanceId: number): Promise<void> {
  console.log(`   🗑️  Destroying instance ${instanceId}...`);
  try {
    await vastRequest("DELETE", `/instances/${instanceId}/`);
    console.log("   ✅ Instance destroyed");
  } catch (err: any) {
    console.warn(`   ⚠️  Could not destroy instance: ${err.message}`);
  }
}

// ── Destroy all instances ─────────────────────────────────────────────────────
export async function destroyAllInstances(): Promise<void> {
  console.log("🗑️  Checking for running instances...");

  const data = await vastRequest("GET", `/instances/`);
  const instances = data.instances ?? [];

  if (instances.length === 0) {
    console.log("   ✅ No running instances found");
    return;
  }

  console.log(`   Found ${instances.length} instance(s) — destroying all...`);
  for (const inst of instances) {
    await destroyInstance(inst.id);
  }
  console.log("   ✅ All instances destroyed");
}

// ── Spin up and get URL (used by orchestrator) ────────────────────────────────
export async function spinUpAndGetUrl(): Promise<VastInstance> {
  console.log("\n🖥️  Spinning up Vast.ai GPU instance...");

  // Hardcoded volume — Wan2.2-TI2V-5B on machine 45111 (South Korea)
  const volume = { volume_id: 36903537, machine_id: 45111 };
  console.log(`   📦 Using volume ${volume.volume_id} on machine ${volume.machine_id}`);

  const offerId = await findBestOffer(volume.machine_id);
  const instanceId = await launchInstance(offerId, volume.volume_id);
  return await waitForReady(instanceId);
}