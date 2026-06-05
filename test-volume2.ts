import "dotenv/config";

const VAST_API = "https://console.vast.ai/api/v0";
const MODEL_VOLUME_ID = 36903537;

async function main() {
  const res = await fetch(VAST_API + "/volumes/", {
    headers: { Authorization: "Bearer " + process.env.VASTAI_API_KEY },
  });
  const data = await res.json();
  const volumes = data.volumes ?? [];
  
  console.log("Total volumes:", volumes.length);
  
  const vol = volumes.find((v: any) => v.id === MODEL_VOLUME_ID);
  
  if (vol) {
    console.log("FOUND volume:", vol.id, "on machine:", vol.machine_id);
  } else {
    console.log("NOT FOUND. Volume IDs present:", volumes.map((v: any) => v.id));
  }
}

main();