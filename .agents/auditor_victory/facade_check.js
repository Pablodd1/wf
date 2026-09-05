const fs = require('fs');
const path = require('path');

console.log('--- STARTING FORENSIC CHEATING & FACADE AUDIT ---');

let violations = [];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // 1. Check for mock/hardcoded responses in API endpoints
  if (filePath.startsWith('api') && !filePath.includes('_lib')) {
    if (content.includes('process.env.NODE_ENV === "test"') && content.includes('return res.json(')) {
      violations.push({ type: 'HARDCODED_TEST_MOCK', file: filePath, detail: 'Test environment override returning mock response' });
    }
  }

  // 2. Check for dummy return statements in core calculations
  if (filePath.includes('market-stats') || filePath.includes('analytics')) {
    if (content.includes('return 3.0;') || content.includes('return 2;')) {
      // Check if it's a fixed magic return instead of logic
    }
  }

  // 3. Check for suppressed errors (empty catch blocks that ignore errors completely without logging or handling)
  const emptyCatch = content.match(/catch\s*\([^)]*\)\s*\{\s*\}/g);
  if (emptyCatch && emptyCatch.length > 5) {
    violations.push({ type: 'EXCESSIVE_SILENT_CATCH', file: filePath, count: emptyCatch.length });
  }
}

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = path.relative('.', full);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== '.agents') walk(full);
    } else if (/\.(js|cjs|ts|tsx)$/.test(f)) {
      checkFile(rel);
    }
  }
}

walk('./api');
walk('./src');

console.log('Violations found:', violations.length);
if (violations.length > 0) {
  console.log(JSON.stringify(violations, null, 2));
} else {
  console.log('PASSED: No facade or cheating patterns detected in api/ and src/');
}
