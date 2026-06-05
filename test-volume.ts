import "dotenv/config";
async function main() {
  const res = await fetch("https://console.vast.ai/api/v0/volumes/", {
    headers: { Authorization: "Bearer " + process.env.VASTAI_API_KEY },
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
main();