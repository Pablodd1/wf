const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function computeConfidence(record) {
  let missingCount = 0;
  if (!record.brand || record.brand === 'Unknown') missingCount++;
  if (!record.reference || record.reference === '') missingCount++;
  if (!record.dial_color || record.dial_color === null) missingCount++;
  if (!record.price_raw || record.price_raw <= 0) missingCount++;
  if (!record.condition || record.condition === 'Unknown') missingCount++;
  if (!record.year || record.year <= 1900) missingCount++;
  
  if (missingCount === 0) return 100;
  if (missingCount === 1) return 90;
  if (missingCount === 2) return 80;
  if (missingCount >= 3) return Math.max(10, 80 - (missingCount - 2) * 10);
  return 50;
}

function computeVerdict(confidence) {
  if (confidence >= 100) return 'APPROVED';
  if (confidence >= 90) return 'REVIEW';
  if (confidence >= 80) return 'HUMAN';
  return 'RECYCLE';
}

async function updateVerdicts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing env vars');
    process.exit(1);
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  console.log('Starting verdict update...');

  // Load backup data
  const backupFile = 'watch_records_backup_2026-06-25T18-23-16-769Z.json';
  const records = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  console.log('Total records:', records.length);

  // Compute updates
  const updates = [];
  let stats = { APPROVED: 0, REVIEW: 0, HUMAN: 0, RECYCLE: 0 };
  
  for (const record of records) {
    const newConfidence = computeConfidence(record);
    const newVerdict = computeVerdict(newConfidence);
    stats[newVerdict]++;
    updates.push({ id: record.id, confidence: newConfidence, verdict: newVerdict });
  }

  console.log('\nNew distribution:');
  Object.entries(stats).forEach(([v,c]) => {
    console.log(`  ${v}: ${c} (${(c/records.length*100).toFixed(1)}%)`);
  });

  // Process in batches with retry
  const BATCH_SIZE = 25;
  const CONCURRENCY = 4;
  let processed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  console.log('\nUpdating records...');
  
  for (let i = 0; i < updates.length; i += BATCH_SIZE * CONCURRENCY) {
    const batchPromises = [];
    for (let j = 0; j < CONCURRENCY && (i + j * BATCH_SIZE) < updates.length; j++) {
      const start = i + j * BATCH_SIZE;
      const batch = updates.slice(start, start + BATCH_SIZE);
      batchPromises.push(updateBatch(batch, headers));
    }
    
    const results = await Promise.all(batchPromises);
    results.forEach(r => {
      totalSuccess += r.success;
      totalFailed += r.failed;
    });
    
    processed += BATCH_SIZE * CONCURRENCY;
    if (processed % 5000 === 0 || processed >= updates.length) {
      console.log(`Progress: ${Math.min(processed, updates.length)}/${updates.length} (${totalSuccess} OK, ${totalFailed} failed)`);
    }
  }

  console.log('\n✅ UPDATE COMPLETE!');
  console.log('Total:', updates.length);
  console.log('Success:', totalSuccess);
  console.log('Failed:', totalFailed);
  console.log('Success rate:', ((totalSuccess / updates.length) * 100).toFixed(2) + '%');
}

async function updateBatch(batch, headers) {
  let success = 0;
  let failed = 0;
  
  for (const update of batch) {
    let retries = 3;
    let ok = false;
    
    while (retries > 0 && !ok) {
      try {
        const resp = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(update.id)}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              confidence: update.confidence,
              verdict: update.verdict,
              reprocessed_at: new Date().toISOString()
            })
          }
        );
        
        if (resp.ok) {
          success++;
          ok = true;
        } else if (resp.status === 401) {
          // Auth error - retry once
          retries--;
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
          } else {
            failed++;
          }
        } else {
          failed++;
          ok = true; // Don't retry other errors
        }
      } catch (e) {
        retries--;
        if (retries <= 0) {
          failed++;
          ok = true;
        }
      }
    }
  }
  
  return { success, failed };
}

updateVerdicts().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
