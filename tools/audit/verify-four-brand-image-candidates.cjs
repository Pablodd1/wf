#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

async function verify(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && /^image\//i.test(contentType)) {
        return { reachable: true, status: response.status, content_type: contentType };
      }
      if (response.status < 500 && response.status !== 429) {
        return { reachable: false, status: response.status, content_type: contentType || null };
      }
    } catch {
      // Retry bounded transient failures.
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 400));
  }
  return { reachable: false, status: null, content_type: null };
}

async function main() {
  const input = option('input');
  const output = option('output');
  const concurrency = Math.min(32, Math.max(1, Number(option('concurrency') || 20)));
  if (!input || !output) throw new Error('--input and --output are required');
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const candidates = Object.entries(report.brands || {}).flatMap(([brand, value]) =>
    (value.exact_image_candidates || []).map(candidate => ({ brand, ...candidate })));
  const results = new Array(candidates.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < candidates.length) {
      const index = next++;
      results[index] = { ...candidates[index], ...(await verify(candidates[index].image_url)) };
      completed += 1;
      const done = completed;
      if (done === candidates.length || done % 1000 === 0) {
        process.stderr.write(`[image-audit] ${done}/${candidates.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
  const byBrand = {};
  for (const brand of Object.keys(report.brands || {})) {
    const rows = results.filter(row => row.brand === brand);
    byBrand[brand] = {
      checked: rows.length,
      reachable_images: rows.filter(row => row.reachable).length,
      unreachable_or_not_image: rows.filter(row => !row.reachable).length,
    };
  }
  const artifact = {
    contract: 'FOUR_BRAND_EXACT_SOURCE_IMAGE_REACHABILITY_V1',
    generated_at: new Date().toISOString(),
    read_only: true,
    public_writes: 0,
    by_brand: byBrand,
    rows: results,
  };
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, by_brand: byBrand }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { verify };
