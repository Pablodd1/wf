'use strict';

const { createClient } = require('@supabase/supabase-js');

async function healthcheck() {
  const nodeVersion = process.version;
  console.log(JSON.stringify({
    event: 'healthcheck_start',
    node_version: nodeVersion,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    timestamp: new Date().toISOString()
  }));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Healthcheck Failure: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const t0 = Date.now();
  const { data, error } = await supabase
    .from('normalization_shadow_checkpoints')
    .select('job_name, rows_analyzed, updated_at')
    .limit(5);

  const dbLatencyMs = Date.now() - t0;

  if (error) {
    throw new Error('Healthcheck Database Probe Failure: ' + error.message);
  }

  const result = {
    status: 'HEALTHY',
    service: 'wf-mariadb-shadow',
    node_version: nodeVersion,
    database_reachable: true,
    database_latency_ms: dbLatencyMs,
    checkpoints_found: data?.length || 0,
    memory_mb: {
      rss: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
      heapUsed: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2))
    },
    timestamp: new Date().toISOString()
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  healthcheck().catch(err => {
    console.error('Healthcheck Error:', err.message);
    process.exit(1);
  });
}

module.exports = { healthcheck };
