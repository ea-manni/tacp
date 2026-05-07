import * as fs from "fs";
import * as path from "path";
import { destroyAllInstances } from "./vast-manager.js";
import "dotenv/config";

const SESSION_FILE = path.join("output", "vastai-session.json");

async function cleanup() {
  await destroyAllInstances();

  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("   ✅ Session file deleted");
  }

  console.log("✅ Cleanup complete");
}

cleanup().catch((err) => {
  console.error("❌ Cleanup failed:", err.message);
  process.exit(1);
});