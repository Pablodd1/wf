// tools/mariadb-live/verify_image_reachability_100.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const CANDIDATE_PATTERNS = [
  { id: 'listings_full', prefix: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/', description: 'Listings Full Subdirectory (Configured Production Root)' },
  { id: 'listings_root', prefix: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/', description: 'Listings Root Directory' },
  { id: 'listings_images', prefix: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/images/', description: 'Listings Images Subdirectory' },
  { id: 'full_root', prefix: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/full/', description: 'Bucket Full Root' },
  { id: 'bucket_root', prefix: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/', description: 'Bucket Root' }
];

async function checkUrlReachability(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 3000 }, (res) => {
      const status = res.statusCode;
      const contentType = res.headers['content-type'] || null;
      res.resume();
      if ((status === 200 || status === 206) && contentType && contentType.startsWith('image/')) {
        return resolve({ reachable: true, status, contentType, error: null });
      }

      if (status === 405 || status === 403 || status === 404) {
        const getReq = https.request(url, { method: 'GET', headers: { Range: 'bytes=0-1023' }, timeout: 3000 }, (getRes) => {
          const getStatus = getRes.statusCode;
          const getCt = getRes.headers['content-type'] || null;
          getRes.resume();
          if ((getStatus === 200 || getStatus === 206) && getCt && getCt.startsWith('image/')) {
            return resolve({ reachable: true, status: getStatus, contentType: getCt, error: null });
          }
          return resolve({ reachable: false, status: getStatus, contentType: getCt, error: `HTTP ${getStatus}` });
        });
        getReq.on('error', (err) => resolve({ reachable: false, status: null, contentType: null, error: err.message }));
        getReq.on('timeout', () => { getReq.destroy(); resolve({ reachable: false, status: 'TIMEOUT', contentType: null, error: 'Request timeout' }); });
        getReq.end();
      } else {
        return resolve({ reachable: false, status, contentType, error: `HTTP ${status}` });
      }
    });
    req.on('error', (err) => resolve({ reachable: false, status: null, contentType: null, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, status: 'TIMEOUT', contentType: null, error: 'Request timeout' }); });
    req.end();
  });
}

async function runImageVerification(keys) {
  const patternCounts = {};
  for (const p of CANDIDATE_PATTERNS) {
    patternCounts[p.id] = { pattern_id: p.id, prefix: p.prefix, reachable_count: 0, total_tested: keys.length };
  }

  // Concurrent worker pool
  const concurrency = 20;
  const results = new Array(keys.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < keys.length) {
      const idx = currentIndex++;
      const key = keys[idx];
      const keyResult = { image_key: key, pattern_checks: {} };

      for (const p of CANDIDATE_PATTERNS) {
        const url = `${p.prefix}${key}`;
        const check = await checkUrlReachability(url);
        keyResult.pattern_checks[p.id] = {
          url,
          status: check.status,
          content_type: check.contentType,
          reachable: check.reachable,
          error: check.error
        };
        if (check.reachable) {
          patternCounts[p.id].reachable_count++;
        }
      }
      results[idx] = keyResult;
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const summary = {
    contract: 'wf-image-verification-100-v2',
    timestamp: new Date().toISOString(),
    total_keys_tested: keys.length,
    configured_production_base: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/',
    pattern_independent_counts: patternCounts,
    pattern_summary: {
      'listings/full/': `${patternCounts.listings_full.reachable_count}/${keys.length}`,
      'listings/': `${patternCounts.listings_root.reachable_count}/${keys.length}`,
      'listings/images/': `${patternCounts.listings_images.reachable_count}/${keys.length}`,
      'full/': `${patternCounts.full_root.reachable_count}/${keys.length}`,
      'bucket root': `${patternCounts.bucket_root.reachable_count}/${keys.length}`
    },
    results_sample: results.slice(0, 5),
    full_results: results
  };

  const outDir = path.resolve('audit-output/mariadb-live/canonical-canary-10k');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'image_reachability_verification.json'), JSON.stringify(summary, null, 2), 'utf-8');

  console.log('IMAGE_VERIFICATION_V2_COMPLETE:');
  console.log(JSON.stringify(summary.pattern_summary, null, 2));
  return summary;
}

module.exports = { runImageVerification, checkUrlReachability, CANDIDATE_PATTERNS };

if (require.main === module) {
  const existingAudit = JSON.parse(fs.readFileSync('audit-output/mariadb-live/canonical-canary-10k/image_reachability_verification.json', 'utf-8'));
  const sampleKeys = existingAudit.full_results.map(r => r.image_key).slice(0, 100);
  runImageVerification(sampleKeys).catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
