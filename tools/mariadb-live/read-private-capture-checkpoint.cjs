'use strict';

const DEFAULT_RUN_KEY = 'full-capture-auctions-1788028958313';

async function readCheckpoint(env = process.env, runKey = DEFAULT_RUN_KEY) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_mariadb_private_raw_checkpoint`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ p_run_key: runKey })
    }
  );

  if (!response.ok) {
    throw new Error(`Checkpoint RPC failed (${response.status}): ${await response.text()}`);
  }

  const checkpoint = await response.json();
  return {
    checked_at: new Date().toISOString(),
    run_key: runKey,
    input_rows: checkpoint.input_rows,
    newly_staged_rows: checkpoint.newly_staged_rows,
    already_staged_identical_rows: checkpoint.already_staged_identical_rows,
    capture_error_rows: checkpoint.capture_error_rows,
    status: checkpoint.status,
    last_created_on: checkpoint.last_created_on,
    last_source_id: checkpoint.last_source_id,
    manifest_sha256: checkpoint.manifest_sha256
  };
}

if (require.main === module) {
  readCheckpoint(process.env, process.argv[2] || DEFAULT_RUN_KEY)
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { readCheckpoint };
