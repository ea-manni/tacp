// Start a RunPod session with tacp-models network volume attached
// Usage: npx tsx src/runpod/start-session.ts

import * as fs from "fs";
import * as path from "path";
import { spinUpAndGetUrl, type RunPodInstance } from "./runpod-manager.js";
import "dotenv/config";

const SESSION_FILE = path.join("output", "runpod-session.json");

async function startSession() {
  console.log("🖥️  Starting RunPod session...");
  console.log("   📦 Network volume: tacp-models (EU-RO-1)");
  console.log("   🎮 GPU target: RTX 4090");
  console.log("   🐳 Image: eolowo/tacp-ltx:latest");

  // Check if session already exists
  if (fs.existsSync(SESSION_FILE)) {
    const existing: RunPodInstance = JSON.parse(
      fs.readFileSync(SESSION_FILE, "utf-8")
    );
    console.log(`\n⚠️  Session already exists:`);
    console.log(`   Pod ID: ${existing.id}`);
    console.log(`   URL:    ${existing.baseUrl}`);
    console.log("   Run cleanup first: npx tsx src/runpod/cleanup.ts");
    return;
  }

  const instance = await spinUpAndGetUrl();

  // Save session
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(instance, null, 2));

  console.log(`\n✅ Session saved to ${SESSION_FILE}`);
  console.log(`   Pod ID: ${instance.id}`);
  console.log(`   URL:    ${instance.baseUrl}`);
  console.log(`\n   Now run: npx tsx src/orchestrator.ts "your story idea"`);
}

startSession().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
