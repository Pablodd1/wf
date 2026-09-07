"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("V2 Consumer Views & Default Sort Order Contract Test", async (t) => {
  const reportPath = path.join(process.cwd(), "audit-output", "mariadb-live", "canary-publication", "canary-publication-report.json");
  assert.ok(fs.existsSync(reportPath), "Canary publication report file must exist");

  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  assert.equal(report.v2_consumer_views_summary.trading_floor_ready_view_v2, 500);
  assert.ok(report.v2_consumer_views_summary.price_research_ready_view_v2 > 0);
  assert.ok(report.v2_consumer_views_summary.seller_listing_analytics_view_v2 > 0);
});
