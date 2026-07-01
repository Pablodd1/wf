const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bptrvfncppbjnchsaxtb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU'
);

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

function randomDateInMonth(month, seed) {
  const day = String((seed % 28) + 1).padStart(2, '0');
  const hour = String((seed * 7) % 24).padStart(2, '0');
  const min = String((seed * 13) % 60).padStart(2, '0');
  return `${month}-${day}T${hour}:${min}:00Z`;
}

async function countByMonth() {
  const ranges = [
    ['2026-01-01','2026-02-01','Jan'],
    ['2026-02-01','2026-03-01','Feb'],
    ['2026-03-01','2026-04-01','Mar'],
    ['2026-04-01','2026-05-01','Apr'],
    ['2026-05-01','2026-06-01','May'],
    ['2026-06-01','2026-07-01','Jun'],
  ];
  const out = {};
  for (const [gte, lt, name] of ranges) {
    const { count, error } = await supabase
      .from('watch_records')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', gte)
      .lt('created_at', lt);
    out[name] = error ? null : count;
  }
  return out;
}

async function run() {
  const start = Date.now();
  let moved = 0;
  let batch = 0;

  console.log('Starting June -> Jan-May redistribution...');
  console.log('Initial counts:', await countByMonth());

  while (true) {
    const { data, error } = await supabase
      .from('watch_records')
      .select('id')
      .gte('created_at', '2026-06-01')
      .lt('created_at', '2026-07-01')
      .limit(100);

    if (error) {
      console.log('Fetch error:', error.message);
      break;
    }
    if (!data || data.length === 0) {
      console.log('No more June records to move.');
      break;
    }

    const ids = data.map(r => r.id);
    const month = MONTHS[batch % MONTHS.length];
    const newDate = randomDateInMonth(month, batch + ids.length);

    const { error: upErr } = await supabase
      .from('watch_records')
      .update({ created_at: newDate })
      .in('id', ids);

    if (upErr) {
      console.log('Update error:', upErr.message);
      break;
    }

    moved += ids.length;
    batch += 1;

    if (batch % 100 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = moved / Math.max(elapsed, 1);
      console.log(`Progress: batches=${batch}, moved=${moved}, rate=${rate.toFixed(1)} rec/s`);
    }

    if (batch % 500 === 0) {
      const m = await countByMonth();
      console.log('Checkpoint counts:', m);
      if ((m.Jun || 0) < 50000) {
        console.log('June under 50k, nearing completion.');
      }
    }
  }

  const finalCounts = await countByMonth();
  const elapsed = (Date.now() - start) / 1000;
  console.log('Finished.');
  console.log('Moved total:', moved);
  console.log('Elapsed sec:', elapsed.toFixed(1));
  console.log('Final counts:', finalCounts);
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
