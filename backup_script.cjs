const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function backup() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing env vars');
    process.exit(1);
  }

  console.log('Starting backup...');
  console.log('URL:', SUPABASE_URL);

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  // Test connection
  const testResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=count&limit=1`, { headers });
  console.log('Connection test:', testResp.status);
  
  if (!testResp.ok) {
    console.error('Connection failed:', await testResp.text());
    process.exit(1);
  }

  // Get count
  const countResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=1`, { headers });
  const sample = await countResp.json();
  console.log('Sample record columns:', Object.keys(sample[0] || {}).join(', '));

  // Fetch in batches
  const batchSize = 1000;
  let offset = 0;
  let allRecords = [];
  let hasMore = true;
  let totalFetched = 0;

  while (hasMore && totalFetched < 100000) { // Safety limit
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=${batchSize}&offset=${offset}`,
      { headers }
    );

    if (!resp.ok) {
      console.error(`Failed at offset ${offset}:`, resp.status);
      break;
    }

    const rows = await resp.json();
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    allRecords.push(...rows);
    totalFetched += rows.length;
    offset += rows.length;

    if (totalFetched % 10000 === 0) {
      console.log(`Fetched ${totalFetched} records...`);
    }

    if (rows.length < batchSize) {
      hasMore = false;
    }
  }

  console.log(`\nTotal records fetched: ${allRecords.length}`);

  // Save timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Save JSON
  const jsonFile = `watch_records_backup_${timestamp}.json`;
  fs.writeFileSync(jsonFile, JSON.stringify(allRecords));
  console.log(`Saved JSON: ${jsonFile} (${(fs.statSync(jsonFile).size / 1024 / 1024).toFixed(2)} MB)`);

  // Save CSV
  if (allRecords.length > 0) {
    const columns = Object.keys(allRecords[0]);
    const csvHeader = columns.join(',');
    const csvRows = allRecords.map(row => {
      return columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          return `"${str}"`;
        }
        return str;
      }).join(',');
    });
    const csvFile = `watch_records_backup_${timestamp}.csv`;
    fs.writeFileSync(csvFile, [csvHeader, ...csvRows].join('\n'));
    console.log(`Saved CSV: ${csvFile} (${(fs.statSync(csvFile).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // Save metadata
  const metaFile = `watch_records_backup_${timestamp}_meta.json`;
  const meta = {
    timestamp: new Date().toISOString(),
    recordCount: allRecords.length,
    columns: allRecords.length > 0 ? Object.keys(allRecords[0]) : [],
    supabaseUrl: SUPABASE_URL
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  console.log(`Saved metadata: ${metaFile}`);

  console.log('\n✅ Backup complete!');
}

backup().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
