// tools/mariadb-live/test-image-reachability.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function testImages(sampleKeys = []) {
  const DO_SPACES_BASE = 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings';
  const results = [];

  for (const key of sampleKeys) {
    const url = `${DO_SPACES_BASE}/${key}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      results.push({
        image_key: key,
        image_url: url,
        http_status: res.status,
        content_type: res.headers.get('content-type'),
        content_length: res.headers.get('content-length'),
        reachable: res.status >= 200 && res.status < 400
      });
    } catch (err) {
      results.push({
        image_key: key,
        image_url: url,
        error: err.message,
        reachable: false
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  return results;
}

module.exports = { testImages };
