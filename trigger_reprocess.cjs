const fs = require("fs");
async function main() {
  const data = JSON.parse(fs.readFileSync("public/parsedWatches.json", "utf8"));
  const toProcess = data.filter(row => row[10] === "HUMAN" || row[10] === "RECYCLE");
  console.log(`Found ${toProcess.length} records. Taking the first 500...`);
  const chunk = toProcess.slice(0, 500);
  
  const token = "temp_admin_reprocess_token_4892";
  const payload = { mode: "batch", limit: 500, offset: 0, records: chunk };
  
  console.log("Sending request to https://watchfacts-poc.vercel.app/api/reprocess ...");
  const res = await fetch("https://watchfacts-poc.vercel.app/api/reprocess", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  if (text.length > 500) {
    console.log("Response starts with:", text.substring(0, 500));
  } else {
    console.log("Response:", text);
  }
}
main().catch(console.error);
