"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../src/pages/PriceResearch.tsx"),
  "utf8",
);

test("every featured Price Research row receives an explicit evidence label", () => {
  assert.match(
    source,
    /exclusionLabel=\{outlierReason\(row\.outlier_reason\)\}/,
  );
  assert.match(source, /row\.is_outlier === true \|\| !hasUsdPrice/);
  assert.match(source, /Excluded from averages · \$\{exclusionLabel\}/);
  assert.match(source, /Included in qualified comparable average/);
});

test("priced outliers are visibly excluded from both chart and statistics", () => {
  assert.match(
    source,
    /excludedFromAverages \? ["']Not used in chart or statistics["']/,
  );
  assert.match(source, /excludedFromAverages \? ["']#8a6500["'] : GOLD/);
  assert.doesNotMatch(
    source,
    /!hasUsdPrice && <div[^>]*>Excluded from averages<\/div>/,
  );
});
