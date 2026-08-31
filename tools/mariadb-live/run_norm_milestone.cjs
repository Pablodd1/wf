// tools/mariadb-live/run_norm_milestone.cjs
'use strict';

const { execSync, spawn } = require('node:child_process');
const path = require('node:path');

console.log('Retrieving production DATABASE_URL in memory...');
const rawVars = execSync('railway variable list --service wf-mariadb-shadow -e production --json', { encoding: 'utf-8' });
const vars = JSON.parse(rawVars);
const dbUrl = vars.DATABASE_URL;

if (!dbUrl) {
  console.error('FATAL: DATABASE_URL not found.');
  process.exit(1);
}

console.log('Starting canonical milestone normalizer process...');
const pyScript = path.resolve('tools/mariadb-live/run_canonical_milestone_normalizer.py');
const env = { ...process.env, DATABASE_URL: dbUrl };

const proc = spawn('python', [pyScript], { env, stdio: 'inherit' });

proc.on('exit', (code) => {
  console.log(`Normalizer process exited with code ${code}`);
  process.exit(code || 0);
});
