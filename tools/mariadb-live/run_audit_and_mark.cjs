// tools/mariadb-live/run_audit_and_mark.cjs
'use strict';
const { execSync } = require('node:child_process');
const path = require('node:path');

const rawVars = execSync('railway variable list --service wf-mariadb-shadow -e production --json', { encoding: 'utf-8' });
const vars = JSON.parse(rawVars);
const dbUrl = vars.DATABASE_URL;

const pyScript = path.resolve('tools/mariadb-live/audit_and_mark_contaminated_checkpoint.py');
const env = { ...process.env, DATABASE_URL: dbUrl };

try {
  const output = execSync(`python "${pyScript}"`, { env, encoding: 'utf-8' });
  console.log(output);
} catch (err) {
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
}
