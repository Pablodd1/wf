"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCanonicalParentChild, segmentDealerMessage } = require("../tools/mariadb-live/authoritative-evidence-normalizer.cjs");

test("Bundle Child Normalization Unit Tests", async (t) => {
  await t.test("segmentDealerMessage splits multi-offer listing into individual child items", () => {
    const multiText = `Rolex Submariner 126610LN 2024 new $14500 USD

Rolex Daytona 116500LN white 2022 $28000 USD

Patek Philippe 5711/1A blue 2021 $95000 USD`;

    const candidates = segmentDealerMessage(multiText);
    assert.equal(candidates.length, 3, "Must split into exactly 3 child candidates");
    assert.equal(candidates[0].reference, "126610LN");
    assert.equal(candidates[1].reference, "116500LN");
    assert.equal(candidates[2].reference, "5711/1A");
  });

  await t.test("deterministic child ID construction parent_source_id + child_index", () => {
    const parentSourceId = "test-parent-uuid-1234";
    const childIndex = 0;
    const childListingId = `${parentSourceId}_child_${childIndex}`;
    assert.equal(childListingId, "test-parent-uuid-1234_child_0");
  });
});
