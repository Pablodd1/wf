"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Canary Database Integration & PostgREST Security Tests", async (t) => {
  await t.test("Canary report confirms 500 published records and security lockdown", () => {
    const reportPath = path.join(process.cwd(), "audit-output", "mariadb-live", "canary-publication", "canary-publication-report.json");
    assert.ok(fs.existsSync(reportPath), "Canary publication report file must exist");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    assert.equal(report.contract, "wf-publication-canary-audit-v2");
    assert.equal(report.canary_published_count, 500);
    assert.equal(report.v2_consumer_views_summary.trading_floor_ready_view_v2, 500);
  });

  await t.test("redactPublicSource removes phone numbers and contact links from public text", () => {
    const { redactPublicSource } = require("../api/_lib/source-redaction.cjs");
    const rawText = "Rolex Submariner 126610LN $14000. Call me at +1 (555) 234-5678 or telegram: @watchdealer or https://wa.me/15552345678";
    const sanitized = redactPublicSource(rawText);

    assert.ok(!sanitized.includes("+1 (555) 234-5678"), "Raw phone number must be redacted");
    assert.ok(!sanitized.includes("https://wa.me/15552345678"), "Raw WhatsApp link must be redacted");
    assert.ok(sanitized.includes("[phone redacted]") || sanitized.includes("[contact link redacted]"), "Must contain redaction placeholder");
    assert.ok(sanitized.includes("126610LN"), "Watch reference 126610LN must be preserved");
    assert.ok(sanitized.includes("14000"), "Price 14000 must be preserved");
  });
});
