'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function runCaptureBenchmark(options = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, 'capture_benchmark.py');
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', [scriptPath], {
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['inherit', 'pipe', 'pipe'],
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
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ status: 'COMPLETE_SUCCESS', stdout, stderr });
      else reject(Object.assign(new Error(stderr.trim() || `Capture process exited with code ${code}`), { code }));
    });
  });
}

if (require.main === module) {
  runCaptureBenchmark().catch(error => {
    console.error('Capture benchmark fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { runCaptureBenchmark };
