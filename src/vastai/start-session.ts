// Start a Vast.ai session with model volume attached
// Usage: npx tsx src/vastai/start-session.ts

import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const VAST_API = "https://console.vast.ai/api/v0";
const SESSION_FILE = path.join("output", "vastai-session.json");

// ── Hardcoded volume config ──────────────────────────────────────────────────
// Wan2.2-TI2V-5B model stored on this volume
const VOLUME_ID = 36903537;
const VOLUME_MACHINE_ID = 45111;
const VOLUME_MOUNT = "/root/.cache";

const ACCEPTED_GPUS = [
  "RTX 4090",
  "RTX 4080 SUPER",
  "RTX 4080",
  "L40S",
  "L40",
  "H100",
];

function getApiKey(): string {
  const key = process.env.VASTAI_API_KEY;
  if (!key) throw new Error("VASTAI_API_KEY not set in .env");
  return key;
}

async function vastFetch(method: string, endpoint: string, body?: any): Promise<any> {
  const res = await fetch(`${VAST_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vast.ai ${res.status}: ${err}`);
  }
  return res.json();
}

async function startSession() {
  console.log("🖥️  Starting Vast.ai session...");
  console.log(`   📦 Volume: ${VOLUME_ID} on machine ${VOLUME_MACHINE_ID}`);

  // Check if session already exists
  if (fs.existsSync(SESSION_FILE)) {
    const existing = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    console.log(`⚠️  Session already exists: Instance ${existing.id} at ${existing.baseUrl}`);
    console.log("   Run cleanup first: npx tsx src/vastai/cleanup.ts");
    return;
  }

  // Step 1: Find offer on the volume's machine
  console.log(`   🔍 Searching for GPU on machine ${VOLUME_MACHINE_ID}...`);

  const searchRes = await fetch(`${VAST_API}/bundles/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      limit: 10,
      type: "on-demand",
      verified: { eq: true },
      rentable: { eq: true },
      rented: { eq: false },
      num_gpus: { eq: 1 },
      gpu_ram: { gte: 24000 },
      machine_id: { eq: VOLUME_MACHINE_ID },
      order: [["dph_total", "asc"]],
    }),
  });

  if (!searchRes.ok) throw new Error(`Search failed: ${await searchRes.text()}`);
  const searchData = await searchRes.json();
  const offers = (searchData.offers ?? []).filter((o: any) =>
    ACCEPTED_GPUS.some((name) => o.gpu_name?.includes(name))
  );

  if (offers.length === 0) {
    console.log("   ❌ Machine 45111 is not available right now (GPU may be rented by someone else).");
    console.log("   Try again later — the volume only works on this specific machine.");
    process.exit(1);
  }

  const offer = offers[0];
  console.log(`   ✅ Found: ${offer.gpu_name}`);
  console.log(`      VRAM:  ${Math.round(offer.gpu_ram / 1024)}GB`);
  console.log(`      Cost:  $${offer.dph_total.toFixed(3)}/hr`);
  console.log(`      Location: ${offer.geolocation}`);

  // Step 2: Launch with volume attached
  console.log("   🚀 Launching instance with volume...");

  const onstart = `#!/bin/bash
set -e
echo "[TACP] Starting uvicorn..."
cd /workspace
nohup uvicorn tacp_server:app --host 0.0.0.0 --port 8080 --app-dir /workspace > /var/log/tacp.log 2>&1 &
echo "[TACP] Server PID: $!"
`;

  const launchData = await vastFetch("PUT", `/asks/${offer.id}/`, {
    client_id: "me",
    image: "eolowo/tacp-ltx:latest",
    disk: 40,
    runtype: "ssh",
    python_utf8: true,
    extra: "-p 8080:8080",
    onstart: onstart,
    volume_info: {
      volume_id: VOLUME_ID,
      mount_path: VOLUME_MOUNT,
    },
  });

  const instanceId = launchData.new_contract;
  if (!instanceId) throw new Error(`No instance ID: ${JSON.stringify(launchData)}`);
  console.log(`   ✅ Instance launched: ID ${instanceId}`);

  // Step 3: Wait for running
  console.log("   ⏳ Waiting for instance...");
  const startTime = Date.now();
  const TIMEOUT = 1800000; // 30 min

  while (Date.now() - startTime < TIMEOUT) {
    await new Promise((r) => setTimeout(r, 10000));

    let instData: any;
    try {
      instData = await vastFetch("GET", `/instances/${instanceId}/`);
    } catch {
      console.log("   ⚠️  Poll failed — retrying...");
      continue;
    }

    const inst = instData.instances?.[0];
    if (!inst) continue;

    const status = inst.actual_status;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`   [${elapsed}s] Status: ${status}`);

    if (status === "running") {
      const host = inst.ssh_host;
      if (!host) { console.log("   Waiting for host IP..."); continue; }

      const port =
        inst.ports?.["8080/tcp"]?.[0]?.HostPort ||
        inst.extra_env?.VAST_TCP_PORT_8080 ||
        8080;

      const baseUrl = `http://${host}:${port}`;
      console.log(`   🔌 ${baseUrl}`);

      // Step 4: Wait for health + model loaded
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        try {
          const hres = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
          if (hres.ok) {
            const h: any = await hres.json();
            console.log(`   ✅ Healthy — GPU: ${h.gpu} | VRAM: ${h.vram_gb}GB`);

            if (h.model_error) {
              console.log(`   ❌ Model error: ${h.model_error}`);
              process.exit(1);
            }
            if (h.model_loaded) {
              console.log("   ✅ Model loaded and ready!");

              const session = { id: instanceId, host, port: inst.ssh_port, baseUrl };
              fs.mkdirSync("output", { recursive: true });
              fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

              console.log(`\n✅ Session saved!`);
              console.log(`   URL: ${baseUrl}`);
              console.log(`   Now run: npx tsx src/orchestrator.ts "your story idea"`);
              return;
            }
            const t = h.loading_elapsed_sec ?? "?";
            console.log(`   ⏳ Model loading... (${t}s)`);
            continue;
          }
        } catch {
          const e = Math.round((i + 1) * 10);
          console.log(`   ⏳ [${e}s] Server not ready yet...`);
        }
      }
      throw new Error("Health check timed out");
    }

    if (["failed", "error", "exited"].includes(status)) {
      throw new Error(`Instance failed: ${status}`);
    }
  }
  throw new Error("Timed out after 30 minutes");
}

startSession().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});