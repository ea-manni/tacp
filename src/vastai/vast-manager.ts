import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const VAST_API = "https://console.vast.ai/api/v0";
const SERVER_PORT = 8080;
const STARTUP_TIMEOUT_MS = 1200000; // 20 minutes
const POLL_INTERVAL_MS = 15000;     // poll every 15 seconds

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

// ── Find best offer ───────────────────────────────────────────────────────────
export async function findBestOffer(): Promise<number> {
  console.log("   🔍 Searching for best GPU offer...");

  const apiKey = process.env.VASTAI_API_KEY;
  if (!apiKey) throw new Error("VASTAI_API_KEY not set in .env");

  // Accepted GPU shortlist — all have 20GB+ VRAM, fast enough for LTX distilled
  const ACCEPTED_GPUS = [
    "RTX 4090",
    "RTX 4080 SUPER",
    "RTX 4080",
    "L40S",
    "L40",
    "H100",
  ];

  const res = await fetch(`${VAST_API}/bundles/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      limit: 50,
      type: "on-demand",
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      num_gpus: { eq: 1 },
      gpu_ram: { gte: 20000 },
      reliability2: { gte: 0.95 },
      cuda_max_good: { gte: 12.0 },
      disk_space: { gte: 50 },
      order: [["dph_total", "asc"]],
    }),
  });

  if (!res.ok) throw new Error(`Search error ${res.status}: ${await res.text()}`);

  const data = await res.json();

  if (!data.offers || data.offers.length === 0) {
    throw new Error("No GPU offers found — try again in a few minutes");
  }

  // Client-side filter — only accept GPUs from our shortlist
  const valid = data.offers.filter((o: any) =>
    o.gpu_ram >= 20000 &&
    o.disk_space >= 50 &&
    o.reliability2 >= 0.95 &&
    o.cuda_max_good >= 12.0 &&
    o.rentable === true &&
    o.rented === false &&
    ACCEPTED_GPUS.some((name) => o.gpu_name?.includes(name))
  );

  if (valid.length === 0) {
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

// ── Launch instance ───────────────────────────────────────────────────────────
export async function launchInstance(offerId: number): Promise<number> {
  console.log("   🚀 Launching GPU instance...");

  const startupScript = fs.readFileSync(
    path.join("src", "vastai", "startup.sh"), "utf-8"
  );
  const serverScript = fs.readFileSync(
    path.join("src", "vastai", "server.py"), "utf-8"
  );

  const onStartCmd = `#!/bin/bash
mkdir -p /workspace
cat > /workspace/tacp_server.py << 'PYEOF'
${serverScript}
PYEOF
${startupScript}`;

  const data = await vastRequest("PUT", `/asks/${offerId}/`, {
    client_id: "me",
    image: "eolowo/tacp-ltx:latest",  // pre-built Docker image
    disk: 60,
    runtype: "ssh",
    python_utf8: true,
    extra: "-p 8080:8080",
  });

  const instanceId = data.new_contract;
  if (!instanceId) throw new Error(`No instance ID returned: ${JSON.stringify(data)}`);

  console.log(`   ✅ Instance launched: ID ${instanceId}`);
  return instanceId;
}

// ── Wait for ready ────────────────────────────────────────────────────────────
export async function waitForReady(instanceId: number): Promise<VastInstance> {
  console.log("   ⏳ Waiting for instance to be ready...");
  console.log("   (Pulling pre-built Docker image — should be ready in 2–3 min)");

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

      // Get external port — Vast.ai maps internal 8080 to a random external port
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

  throw new Error("Instance startup timed out after 20 minutes");
}

// ── Health check ──────────────────────────────────────────────────────────────
async function waitForHealth(baseUrl: string, instanceId: number): Promise<boolean> {
  console.log(`   ⏳ Checking server health at ${baseUrl}...`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 15000));

    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`   ✅ Server healthy — GPU: ${data.gpu} | VRAM: ${data.vram_gb}GB`);
        return true;
      }
    } catch {
      const elapsed = Math.round((i + 1) * 15);
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
  const offerId = await findBestOffer();
  const instanceId = await launchInstance(offerId);
  return await waitForReady(instanceId);
}