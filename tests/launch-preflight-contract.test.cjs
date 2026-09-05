"use strict";

const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

test("launch preflight verifies the current immutable checkpoint and remains blocked", () => {
  const source = fs.readFileSync("tools/mariadb-live/run-launch-preflight.cjs", "utf8");

  assert.match(source, /inputRows:\s*1487333/);
  assert.match(source, /captureErrorRows:\s*8/);
  assert.match(source, /capture_error_rows\s*\?\?\s*actualCp\.capture_errors_count/);
  assert.match(source, /BLOCKED_PENDING_CTO_AUTHORIZATION/);
  assert.doesNotMatch(source, /READY_FOR_FINAL_AUTHORIZATION/);
  assert.doesNotMatch(source, /951750/);
});

