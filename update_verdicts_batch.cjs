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

  console.log('Starting batch verdict update...');

  const records = JSON.parse(fs.readFileSync('watch_records_backup_2026-06-25T18-23-16-769Z.json', 'utf8'));
  console.log('Total records:', records.length);

  let processed = 0;
  let success = 0;
  let failed = 0;
  const total = records.length;

  for (const record of records) {
    const newConfidence = computeConfidence(record);
    const newVerdict = computeVerdict(newConfidence);
    
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(record.id)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            confidence: newConfidence,
            verdict: newVerdict,
            reprocessed_at: new Date().toISOString()
          })
        }
      );
      
      if (resp.ok) {
        success++;
      } else {
        failed++;
        if (failed <= 3) {
          console.error(`Failed ${record.id}:`, resp.status);
        }
      }
    } catch (e) {
      failed++;
      if (failed <= 3) {
        console.error(`Error ${record.id}:`, e.message);
      }
    }
    
    processed++;
    if (processed % 1000 === 0 || processed === total) {
      const pct = ((processed / total) * 100).toFixed(1);
      console.log(`Progress: ${processed}/${total} (${pct}%) - ${success} OK, ${failed} failed`);
    }
  }

  console.log('\nUPDATE COMPLETE!');
  console.log('Total:', total);
  console.log('Success:', success);
  console.log('Failed:', failed);
  console.log('Success rate:', ((success / total) * 100).toFixed(2) + '%');
}

updateVerdicts().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
