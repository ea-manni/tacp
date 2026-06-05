import "dotenv/config";
import { generateStill } from "./imageGen";

console.log("Key loaded:", process.env.GEMINI_API_KEY ? "YES" : "NO — check .env file");

async function main() {
  await generateStill(
    "cinematic photorealistic ancient Babylonian marketplace at golden hour, tall clay buildings, merchants in flowing robes, dramatic side lighting, documentary film style",
    "test-pollinations",
    1
  );
  console.log("Done — check public/stills/test-pollinations/1.jpg");
}

main().catch(console.error);