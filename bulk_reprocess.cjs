const fs = require('fs');

async function run() {
  const data = JSON.parse(fs.readFileSync('public/parsedWatches.json', 'utf8'));
  const targetBrands = ['Richard Mille', 'Tudor', 'Omega', 'Cartier', 'TAG Heuer', 'Zenith'];
  
  const records = data.filter(d => 
    d[1] && targetBrands.some(tb => d[1].toLowerCase().includes(tb.toLowerCase()))
  );

  const batch = [];
  const byBrand = {};
  for(const r of records) {
    if(!byBrand[r[1]]) byBrand[r[1]] = [];
    byBrand[r[1]].push(r);
  }
  for(const b of Object.keys(byBrand)) {
    batch.push(...byBrand[b].slice(0, 30));
  }

  const token = "temp_admin_reprocess_token_4892";
  const runId = Math.random().toString(36).substring(7);

  console.log(`Starting bulk ingestion of ${batch.length} records...`);

  for (let i = 0; i < batch.length; i++) {
    const record = batch[i];
    const rawMessage = record[8] + " [REPROCESS:" + runId + "]";
    
    try {
      const res = await fetch("http://localhost:3000/api/ingest", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rawMessage: rawMessage })
      });
      const json = await res.json();
      console.log(`[${i+1}/${batch.length}] -> Verdict: ${json.records?.[0]?.verdict} | Brand: ${json.records?.[0]?.brand} | Ref: ${json.records?.[0]?.reference} | Catalog: ${json.records?.[0]?.catalog_status}`);
    } catch (e) {
      console.error(`[${i+1}/${batch.length}] -> Failed: ${e.message}`);
    }
  }
}

run().catch(console.error);
