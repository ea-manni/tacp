// Start a persistent Vast.ai session
// Run once at the start of your work session
// Usage: npx tsx src/vastai/start-session.ts

import * as fs from "fs";
import * as path from "path";
import { findBestOffer, launchInstance, waitForReady } from "./vast-manager.js";
import "dotenv/config";

const SESSION_FILE = path.join("output", "vastai-session.json");

async function startSession() {
  console.log("🖥️  Starting Vast.ai session...");

  // Check if session already exists
  if (fs.existsSync(SESSION_FILE)) {
    const existing = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    console.log(`⚠️  Session already exists: Instance ${existing.id} at ${existing.baseUrl}`);
    console.log("   Run cleanup first if you want to start a new session:");
    console.log("   npx tsx src/vastai/cleanup.ts");
    return;
  }

  const offerId = await findBestOffer();
  const instanceId = await launchInstance(offerId);
  const instance = await waitForReady(instanceId);

  // Save session to disk
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(instance, null, 2));

  console.log("\n✅ Session started and saved!");
  console.log(`   Instance ID: ${instance.id}`);
  console.log(`   Server URL: ${instance.baseUrl}`);
  console.log("\n   Now run:");
  console.log(`   npx tsx src/grok/generate-clips.ts "output/packages/<story>.json"`);
  console.log("\n   When done, destroy the instance:");
  console.log("   npx tsx src/vastai/cleanup.ts");
}

startSession().catch((err) => {
  console.error("❌ Failed to start session:", err.message);
  process.exit(1);
});