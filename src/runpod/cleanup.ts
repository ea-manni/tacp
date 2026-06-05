// Terminate all RunPod pods and clear the session file
// Usage: npx tsx src/runpod/cleanup.ts

import * as fs from "fs";
import * as path from "path";
import { terminateAllPods } from "./runpod-manager.js";
import "dotenv/config";

const SESSION_FILE = path.join("output", "runpod-session.json");

async function cleanup() {
  console.log("🧹 Running RunPod cleanup...");

  await terminateAllPods();

  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("   ✅ Session file deleted");
  } else {
    console.log("   ℹ️  No session file found");
  }

  console.log("✅ Cleanup complete");
}

cleanup().catch((err) => {
  console.error("❌ Cleanup failed:", err.message);
  process.exit(1);
});
