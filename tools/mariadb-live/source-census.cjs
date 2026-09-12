'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function runCensus(options = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, 'source_census.py');
    const env = { ...process.env, ...(options.env || {}) };

    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', [scriptPath], {
      env,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({ status: 'COMPLETE_SUCCESS', stdout, stderr });
      } else {
        const err = new Error(stderr.trim() || `Census process exited with code ${code}`);
        err.code = code;
        reject(err);
      }
    });

    child.on('error', err => {
      reject(err);
    });
  });
}

if (require.main === module) {
  runCensus().catch(err => {
    console.error('Census fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { runCensus };
