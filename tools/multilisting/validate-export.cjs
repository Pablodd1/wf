'use strict';

const fs = require('node:fs');
const path = require('node:path');

const outputDirs = String(process.env.MULTILISTING_VALIDATE_OUTPUTS || '')
  .split(';')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => path.resolve(value));

if (!outputDirs.length) {
  outputDirs.push(
    path.resolve('audit-output/multilistings-full-20260719'),
    path.resolve('audit-output/multilistings-full-20260719-part-b'),
  );
}

async function* physicalJsonLines(filePath) {
  let pending = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    let newline = data.indexOf(10, start);
    while (newline >= 0) {
      const end = newline > start && data[newline - 1] === 13 ? newline - 1 : newline;
      yield data.subarray(start, end).toString('utf8');
      start = newline + 1;
      newline = data.indexOf(10, start);
    }
    pending = data.subarray(start);
  }
  if (pending.length) yield pending.toString('utf8').replace(/\r$/, '');
}

async function validatePartition(outputDir) {
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const jsonlPath = path.join(outputDir, 'multilistings.jsonl');
  if (!fs.existsSync(checkpointPath)) throw new Error(`Missing checkpoint: ${checkpointPath}`);
  if (!fs.existsSync(jsonlPath)) throw new Error(`Missing JSONL export: ${jsonlPath}`);

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  if (checkpoint.completed !== true) throw new Error(`Partition is not complete: ${outputDir}`);
  if (Number(checkpoint.missingSourceRows) !== 0) {
    throw new Error(`Checkpoint reports missing source rows: ${outputDir}`);
  }

  let rows = 0;
  let candidates = 0;
  let missingSources = 0;
  let previousId = '';
  let firstId = '';
  let lastId = '';
  for await (const line of physicalJsonLines(jsonlPath)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at ${jsonlPath}:${rows + 1}: ${error.message}`);
    }

    const sourceId = String(row.source_record_id || '');
    if (!sourceId) throw new Error(`Missing source_record_id at ${jsonlPath}:${rows + 1}`);
    if (previousId && sourceId <= previousId) {
      throw new Error(`Source IDs are not strictly increasing at ${jsonlPath}:${rows + 1}`);
    }
    if (checkpoint.startAfterId && sourceId <= checkpoint.startAfterId) {
      throw new Error(`Source ID is outside start boundary at ${jsonlPath}:${rows + 1}`);
    }
    if (checkpoint.stopBeforeId && sourceId >= checkpoint.stopBeforeId) {
      throw new Error(`Source ID is outside stop boundary at ${jsonlPath}:${rows + 1}`);
    }
    if (!row.source || row.source.id !== sourceId) missingSources += 1;
    if (
      row.review_policy?.parent_immutable !== true ||
      row.review_policy?.split_children_before_duplicate_review !== true ||
      row.review_policy?.suppress_parent_only_after_approval !== true
    ) {
      throw new Error(`Unsafe review policy at ${jsonlPath}:${rows + 1}`);
    }

    rows += 1;
    candidates += Number(row.candidate_count || 0);
    firstId ||= sourceId;
    lastId = sourceId;
    previousId = sourceId;
  }

  if (rows !== Number(checkpoint.exported)) {
    throw new Error(`Line/checkpoint mismatch in ${outputDir}: ${rows} != ${checkpoint.exported}`);
  }
  if (missingSources !== 0) throw new Error(`Export contains ${missingSources} missing source rows: ${outputDir}`);
  if (!checkpoint.clientFilter && lastId !== checkpoint.lastId) {
    throw new Error(`Last ID/checkpoint mismatch in ${outputDir}: ${lastId} != ${checkpoint.lastId}`);
  }
  if (checkpoint.clientFilter && lastId > checkpoint.lastId) {
    throw new Error(`Last exported ID exceeds scan cursor in ${outputDir}: ${lastId} > ${checkpoint.lastId}`);
  }

  return {
    outputDir,
    rows,
    candidates,
    missingSources,
    firstId,
    lastId,
    startAfterId: checkpoint.startAfterId,
    stopBeforeId: checkpoint.stopBeforeId,
    bytes: fs.statSync(jsonlPath).size,
  };
}

async function main() {
  const partitions = [];
  for (const outputDir of outputDirs) partitions.push(await validatePartition(outputDir));
  const ordered = [...partitions].sort((left, right) => left.firstId.localeCompare(right.firstId));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].lastId >= ordered[index].firstId) {
      throw new Error(`Partition overlap: ${ordered[index - 1].outputDir} -> ${ordered[index].outputDir}`);
    }
  }

  process.stdout.write(`${JSON.stringify({
    event: 'multilisting_export_validated',
    partitions,
    totals: {
      rows: partitions.reduce((sum, item) => sum + item.rows, 0),
      candidates: partitions.reduce((sum, item) => sum + item.candidates, 0),
      missingSources: partitions.reduce((sum, item) => sum + item.missingSources, 0),
      bytes: partitions.reduce((sum, item) => sum + item.bytes, 0),
    },
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'multilisting_export_validation_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { physicalJsonLines, validatePartition };
