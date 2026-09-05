'use strict';

const fs = require('node:fs');

const GIB = 1024 ** 3;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase disk audit GET failed (${response.status})`);
  return response.json();
}

function sanitizeDiskAudit(projectRef, disk, util, autoscale, minimumHeadroomGib) {
  const configuredSizeGib = finiteNumber(disk?.attributes?.size_gb, 'configured disk size');
  const fsSizeBytes = finiteNumber(util?.metrics?.fs_size_bytes, 'filesystem size');
  const fsUsedBytes = finiteNumber(util?.metrics?.fs_used_bytes, 'filesystem used bytes');
  const fsAvailableBytes = finiteNumber(util?.metrics?.fs_avail_bytes, 'filesystem available bytes');
  if (configuredSizeGib <= 0 || fsSizeBytes <= 0 || fsUsedBytes > fsSizeBytes) {
    throw new Error('Inconsistent Supabase disk metrics');
  }
  const availableGib = fsAvailableBytes / GIB;
  return {
    contract: 'curated-luxury-qnsa-read-only-disk-audit-v1',
    project_ref: projectRef,
    observed_at: util?.timestamp || null,
    disk: {
      type: disk?.attributes?.type || null,
      configured_size_gib: configuredSizeGib,
      filesystem_size_gib: fsSizeBytes / GIB,
      used_gib: fsUsedBytes / GIB,
      available_gib: availableGib,
      utilization_percent: (fsUsedBytes / fsSizeBytes) * 100,
      last_modified_at: disk?.last_modified_at || null,
    },
    autoscale: {
      growth_percent: autoscale?.growth_percent ?? null,
      min_increment_gib: autoscale?.min_increment_gb ?? null,
      max_size_gib: autoscale?.max_size_gb ?? null,
    },
    gate: {
      minimum_headroom_gib: minimumHeadroomGib,
      headroom_satisfied: availableGib >= minimumHeadroomGib,
    },
  };
}

async function auditDiskCapacity(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const projectRef = env.SUPABASE_PROJECT_REF;
  const expectedProjectRef = env.EXPECTED_PROJECT_REF;
  const token = env.SUPABASE_ACCESS_TOKEN;
  const minimumHeadroomGib = finiteNumber(env.MINIMUM_HEADROOM_GIB, 'minimum headroom');
  if (!token || projectRef !== expectedProjectRef || !/^[a-z0-9]{20}$/.test(projectRef || '')) {
    throw new Error('Pinned Supabase project authorization is unavailable');
  }
  const base = `https://api.supabase.com/v1/projects/${projectRef}/config/disk`;
  const [disk, util, autoscale] = await Promise.all([
    getJson(fetchImpl, base, token),
    getJson(fetchImpl, `${base}/util`, token),
    getJson(fetchImpl, `${base}/autoscale`, token),
  ]);
  return sanitizeDiskAudit(projectRef, disk, util, autoscale, minimumHeadroomGib);
}

if (require.main === module) {
  auditDiskCapacity().then(audit => {
    const output = process.env.DISK_AUDIT_PATH || 'qnsa-disk-capacity-audit.json';
    fs.writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.env.GITHUB_ENV) {
      fs.appendFileSync(process.env.GITHUB_ENV,
        `DISK_CONFIGURED_GIB=${audit.disk.configured_size_gib}\nDISK_AVAILABLE_GIB=${audit.disk.available_gib}\n`);
    }
    process.stdout.write(`${JSON.stringify({
      contract: audit.contract,
      project_ref: audit.project_ref,
      configured_size_gib: audit.disk.configured_size_gib,
      used_gib: audit.disk.used_gib,
      available_gib: audit.disk.available_gib,
      utilization_percent: audit.disk.utilization_percent,
      headroom_satisfied: audit.gate.headroom_satisfied,
    })}\n`);
  }).catch(error => {
    console.error(JSON.stringify({ event: 'qnsa_disk_audit_failed', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { GIB, auditDiskCapacity, sanitizeDiskAudit };
