// Backup watch_records table to CSV + JSON
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function backup() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  console.log('Starting backup of watch_records...');
  console.log('URL:', SUPABASE_URL);

  // Get total count first
  const countResp = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?select=id&limit=1`, { headers });
  console.log('Connection test:', countResp.status);

  // Fetch in batches of 1000
  const batchSize = 1000;
  let offset = 0;
  let allRecords = [];
  let hasMore = true;

  while (hasMore) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?select=*&limit=${batchSize}&offset=${offset}`,
      { headers }
    );

    if (!resp.ok) {
      console.error(`Failed at offset ${offset}:`, resp.status, await resp.text());
      break;
    }

    const rows = await resp.json();
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    allRecords.push(...rows);
    offset += rows.length;

    if (offset % 10000 === 0) {
      console.log(`Fetched ${offset} records...`);
    }

    if (rows.length < batchSize) {
      hasMore = false;
    }
  }

  console.log(`\nTotal records fetched: ${allRecords.length}`);

  // Save as JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = `watch_records_backup_${timestamp}.json`;
  fs.writeFileSync(jsonFile, JSON.stringify(allRecords, null, 2));
  console.log(`Saved JSON: ${jsonFile} (${(fs.statSync(jsonFile).size / 1024 / 1024).toFixed(2)} MB)`);

  // Save as CSV
  const csvFile = `watch_records_backup_${timestamp}.csv`;
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
    fs.writeFileSync(csvFile, [csvHeader, ...csvRows].join('\n'));
    console.log(`Saved CSV: ${csvFile} (${(fs.statSync(csvFile).size / 1024 / 1024).toFixed(2)} MB)`);
  }

  // Save metadata
  const metaFile = `watch_records_backup_${timestamp}_meta.json`;
  const meta = {
    timestamp: new Date().toISOString(),
    recordCount: allRecords.length,
    columns: allRecords.length > 0 ? Object.keys(allRecords[0]) : [],
    jsonFile,
    csvFile,
    supabaseUrl: SUPABASE_URL.replace(/\/\/[^@]+@/, '//***@') // redact credentials
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  console.log(`Saved metadata: ${metaFile}`);

  console.log('\n✅ Backup complete!');
  console.log('Files created:');
  console.log(`  - ${jsonFile}`);
  console.log(`  - ${csvFile}`);
  console.log(`  - ${metaFile}`);
}

backup().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
