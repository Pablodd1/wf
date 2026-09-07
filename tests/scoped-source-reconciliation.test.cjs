"use strict";

const test = require("node:test");
const assert = require("node:assert");

test("Scoped Reconciliation Invariant: Disjoint sets and exact union count", () => {
  const stagedIds = new Set(["id-1", "id-2", "id-3", "id-4"]);
  const errorIds = new Set(["id-err-1", "id-err-2"]);

  const overlap = new Set([...stagedIds].filter(x => errorIds.has(x)));
  assert.strictEqual(overlap.size, 0, "Staged and error sets must be strictly disjoint");

  const union = new Set([...stagedIds, ...errorIds]);
  assert.strictEqual(union.size, stagedIds.size + errorIds.size, "Union count must equal sum of staged and errors");
});

test("Scoped Reconciliation Boundary: Exact lower and upper bounds filtering", () => {
  const lowerCreatedOn = "2025-01-08T13:28:49.000Z";
  const lowerId = "7534d09b-28b9-4052-8005-228c32f972df";
  const upperCreatedOn = "2026-08-29T14:42:32.000Z";
  const upperId = "f1bdf67a-3723-41c6-a1e3-35c5ca9138b0";

  function isWithinBounds(createdOn, id) {
    const isAfterLower = createdOn > lowerCreatedOn || (createdOn === lowerCreatedOn && id >= lowerId);
    const isBeforeUpper = createdOn < upperCreatedOn || (createdOn === upperCreatedOn && id <= upperId);
    return isAfterLower && isBeforeUpper;
  }

  // Valid boundary cases
  assert.strictEqual(isWithinBounds("2025-01-08T13:28:49.000Z", lowerId), true, "Lower boundary tuple is inclusive");
  assert.strictEqual(isWithinBounds("2026-08-29T14:42:32.000Z", upperId), true, "Upper boundary tuple is inclusive");
  assert.strictEqual(isWithinBounds("2025-06-15T10:00:00.000Z", "any-id"), true, "Interior timestamp is valid");

  // Invalid boundary cases
  assert.strictEqual(isWithinBounds("2025-01-08T13:28:48.000Z", "ffffffff-ffff-ffff-ffff-ffffffffffff"), false, "Prior timestamp is excluded");
  assert.strictEqual(isWithinBounds("2025-01-08T13:28:49.000Z", "00000000-0000-0000-0000-000000000000"), false, "Lower timestamp with smaller ID is excluded");
  assert.strictEqual(isWithinBounds("2026-08-29T14:42:33.000Z", "00000000-0000-0000-0000-000000000000"), false, "Subsequent timestamp is excluded");
  assert.strictEqual(isWithinBounds("2026-08-29T14:42:32.000Z", "fffffffa-3723-41c6-a1e3-35c5ca9138b0"), false, "Upper timestamp with larger ID is excluded");
});
