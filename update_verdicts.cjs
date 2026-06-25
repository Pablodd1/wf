const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// New scoring function
function computeConfidence(record) {
  let missingCount = 0;
  
  // Check each required field
  if (!record.brand || record.brand === 'Unknown') missingCount++;
  if (!record.reference || record.reference === '') missingCount++;
  if (!record.dial_color || record.dial_color === null) missingCount++;
  if (!record.price_raw || record.price_raw <= 0) missingCount++;
  if (!record.condition || record.condition === 'Unknown') missingCount++;
  if (!record.year || record.year <= 1900) missingCount++;
  
  // Score based on missing count
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
  console.log('URL:', SUPABASE_URL);

  // Load backup data
  const backupFile = 'watch_records_backup_2026-06-25T18-23-16-769Z.json';
  console.log('Loading backup:', backupFile);
  const records = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  console.log('Total records to process:', records.length);

  // Compute new verdicts
  const updates = [];
  let stats = { APPROVED: 0, REVIEW: 0, HUMAN: 0, RECYCLE: 0 };
  
  for (const record of records) {
    const newConfidence = computeConfidence(record);
    const newVerdict = computeVerdict(newConfidence);
    
    stats[newVerdict]++;
    
    updates.push({
      id: record.id,
      confidence: newConfidence,
      verdict: newVerdict,
      _old_verdict: record.verdict,
      _old_confidence: record.confidence
    });
  }

  console.log('\nNew verdict distribution:');
  Object.entries(stats).sort((a,b) => b[1]-a[1]).forEach(([v,c]) => {
    console.log('  ' + v + ':', c, '(' + (c/records.length*100).toFixed(1) + '%)');
  });

  // Save update log
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = `verdict_update_log_${timestamp}.json`;
  fs.writeFileSync(logFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalRecords: records.length,
    distribution: stats,
    updates: updates.slice(0, 100) // First 100 for review
  }, null, 2));
  console.log('\nSaved update log:', logFile);

  // BATCH UPDATE - Process in batches of 100
  const BATCH_SIZE = 100;
  let processed = 0;
  let errors = 0;
  
  console.log('\nStarting batch updates...');
  
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    
    // Update each record individually (Supabase REST doesn't support bulk update well)
    for (const update of batch) {
      try {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(update.id)}`,
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
        
        if (!resp.ok) {
          console.error(`Failed to update ${update.id}:`, resp.status);
          errors++;
        }
      } catch (e) {
        console.error(`Error updating ${update.id}:`, e.message);
        errors++;
      }
    }
    
    processed += batch.length;
    if (processed % 1000 === 0) {
      console.log(`Processed ${processed}/${records.length} records... (${errors} errors)`);
    }
  }

  console.log('\n✅ Update complete!');
  console.log('Total processed:', processed);
  console.log('Errors:', errors);
  console.log('Success rate:', ((processed - errors) / processed * 100).toFixed(2) + '%');
}

updateVerdicts().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
