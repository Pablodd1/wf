"use strict";

const { getClient } = require("../_lib/supabase");
const { readSnapshotCount } = require("../_lib/snapshot-count.cjs");
const { redactPublicSource } = require("../_lib/source-redaction.cjs");
const {
  assertDemandKeysetOrder,
  assertKeysetOrder,
  computeCursorScope,
  decodeCursorEnvelope,
  encodeCursorEnvelope,
  mapSnapshotRpcError
} = require("../_lib/canary-keyset.cjs");
const { enforceListingDisplayContract } = require("../../shared/listing-display-contract.cjs");

const ALLOWED_QUERY_PARAMS = new Set([
  "reference",
  "q",
  "query",
  "search",
  "brand",
  "model",
  "dial",
  "dial_color",
  "condition",
  "evidencePageSize",
  "pageSize",
  "limit",
  "cursor",
  "demandCursor",
  "demandPage",
  "demandPageSize"
]);

function parseStrictInteger(paramName, val, { min = 1, max = Infinity, defaultValue = null } = {}) {
  if (val === undefined || val === null) return defaultValue;
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) {
    const err = new Error(`Invalid integer value for parameter "${paramName}": "${val}". Must be a numeric integer.`);
    err.statusCode = 400;
    throw err;
  }
  const parsed = parseInt(s, 10);
  if (parsed < min || parsed > max) {
    const err = new Error(`Parameter "${paramName}" value ${parsed} is outside allowed range [${min}, ${max}].`);
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function readCohortDimension(query, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(query, name)) {
      const raw = String(query[name] ?? "").trim();
      if (!raw || raw.toLowerCase() === "unspecified") {
        return { supplied: true, value: null };
      }
      return { supplied: true, value: raw };
    }
  }
  return { supplied: false, value: null };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const query = req.query || {};

    // Explicit rejection of evidencePage or page: Price Research WTS evidence uses ONLY keyset cursor
    if (Object.prototype.hasOwnProperty.call(query, "evidencePage") || Object.prototype.hasOwnProperty.call(query, "page")) {
      return res.status(400).json({
        error: "Offset pagination (evidencePage/page) is not supported. Use keyset cursor pagination with 'cursor' and 'pageSize'."
      });
    }

    // 1. Strict validation: reject unsupported query parameters with HTTP 400
    for (const param of Object.keys(query)) {
      if (!ALLOWED_QUERY_PARAMS.has(param)) {
        return res.status(400).json({ error: `Unsupported filter parameter: "${param}"` });
      }
    }

    // Validate limit / pageSize / evidencePageSize strictly
    const rawLimit = query.evidencePageSize !== undefined
      ? query.evidencePageSize
      : (query.pageSize !== undefined ? query.pageSize : query.limit);
    const limit = parseStrictInteger("evidencePageSize", rawLimit, { min: 1, max: 100, defaultValue: 50 });

    // Validate demandPageSize strictly; demand lane is snapshot-keyset paginated
    // via demandCursor (Phase 5.2). Legacy OFFSET param demandPage is a hard 400
    // with migration guidance — never a silent page-1 fallback.
    const demandPageSize = parseStrictInteger("demandPageSize", query.demandPageSize, { min: 1, max: 100, defaultValue: 20 });
    if (query.demandPage !== undefined) {
      return res.status(400).json({
        success: false,
        error: "Offset pagination (demandPage) is not supported on the V2 demand lane. Use demandCursor from the previous response's demand_evidence.next_cursor; restart without it for page 1."
      });
    }
    const demandCursorStr = query.demandCursor || null;

    // Cursor is decoded AFTER filter normalization (below) so the scope
    // fingerprint is computed from the exact normalized values used by the RPC.
    const cursorStr = query.cursor || null;

    const brandQuery = query.brand ? String(query.brand).trim() : null;
    const referenceQuery = query.reference || query.q || query.search || query.query
      ? String(query.reference || query.q || query.search || query.query).trim()
      : null;
    const modelQuery = query.model ? String(query.model).trim() : null;
    const dialQuery = readCohortDimension(query, ["dial", "dial_color"]);
    const conditionQuery = readCohortDimension(query, ["condition"]);

    // Decode + validate the snapshot cursor envelope against the normalized
    // filter scope BEFORE any database access (fail closed with HTTP 400;
    // never restart at page 1).
    const cursorFilters = {
      brand: brandQuery,
      reference: referenceQuery,
      model: modelQuery,
      dialSupplied: dialQuery.supplied,
      dial: dialQuery.value,
      conditionSupplied: conditionQuery.supplied,
      condition: conditionQuery.value
    };
    const cursorScope = computeCursorScope("price_research", cursorFilters);
    // Demand lane is a separate cursor family (Phase 5.2): its own scope surface
    // and its own snapshot (demand rows are members of TRADING FLOOR snapshots).
    const demandScope = computeCursorScope("pr_wtb_demand", cursorFilters);
    let parsedDemandCursor = null;
    if (demandCursorStr) {
      try {
        parsedDemandCursor = decodeCursorEnvelope(demandCursorStr, {
          surface: "pr_wtb_demand",
          filters: cursorFilters
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: `Invalid demand cursor: ${error.message}` });
      }
    }
    let parsedCursor = null;
    if (cursorStr) {
      try {
        parsedCursor = decodeCursorEnvelope(cursorStr, {
          surface: "price_research",
          filters: cursorFilters
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: `Invalid cursor: ${error.message}` });
      }
    }

    const supabase = getClient();

    // Phase 5: first page (no cursor) opens an immutable keyset snapshot;
    // subsequent pages reuse the snapshot id carried by the cursor envelope.
    let snapshotId = parsedCursor ? parsedCursor.snapshot : null;
    if (!snapshotId) {
      const { data: openedSnapshot, error: snapshotError } = await supabase.rpc("open_price_research_keyset_snapshot", {});
      if (snapshotError) throw snapshotError;
      if (typeof openedSnapshot !== "string" || !openedSnapshot) {
        throw new Error("snapshot_open_failed: snapshot registry did not return a snapshot id");
      }
      snapshotId = openedSnapshot;
    }

    // Demand has its own Trading Floor snapshot. Open it before counting.
    let demandSnapshotId = parsedDemandCursor ? parsedDemandCursor.snapshot : null;
    if (!demandSnapshotId) {
      const { data: openedDemandSnapshot, error: demandSnapshotError } = await supabase.rpc("open_trading_floor_keyset_snapshot", {});
      if (demandSnapshotError) throw demandSnapshotError;
      if (typeof openedDemandSnapshot !== "string" || !openedDemandSnapshot) {
        throw new Error("snapshot_open_failed: snapshot registry did not return a demand snapshot id");
      }
      demandSnapshotId = openedDemandSnapshot;
    }

    // Counts describe frozen evidence, not today's live view.
    const wtsTotalCount = await readSnapshotCount(supabase, "get_price_research_snapshot_count", {
      p_snapshot_id: snapshotId,
      p_demand: false,
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied,
      p_condition: conditionQuery.supplied ? conditionQuery.value : null,
      p_filter_condition: conditionQuery.supplied
    });
    const wtbTotalCount = await readSnapshotCount(supabase, "get_price_research_snapshot_count", {
      p_snapshot_id: demandSnapshotId,
      p_demand: true,
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied,
      p_condition: conditionQuery.supplied ? conditionQuery.value : null,
      p_filter_condition: conditionQuery.supplied
    });

    // 2. Exact Database condition facets/counts (FAIL CLOSED on error)
    const { data: facetRows, error: facetErr } = await supabase.rpc("get_price_research_condition_facets_v2", {
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied
    });
    if (facetErr) throw facetErr;
    const conditionCounts = {};
    for (const row of (facetRows || [])) {
      if (row && row.condition) {
        conditionCounts[row.condition] = Number(row.listing_count || 0);
      }
    }

    // 3. Full-cohort breakdown counts (FAIL CLOSED on error)
    const { data: breakdownRows, error: breakdownErr } = await supabase.rpc("get_price_research_cohort_breakdown_v2", {
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied,
      p_condition: conditionQuery.supplied ? conditionQuery.value : null,
      p_filter_condition: conditionQuery.supplied
    });
    if (breakdownErr) throw breakdownErr;
    const cohortBreakdown = (breakdownRows && breakdownRows[0]) || {
      total_listings: 0,
      wts_count: wtsTotalCount,
      wtb_count: wtbTotalCount,
      qualified_wts_count: 0,
      retained_audit_evidence_count: 0,
      iqr_outliers_count: 0,
      excluded_not_wts: 0,
      excluded_unresolved_currency: 0,
      excluded_ineligible_flag: 0,
      excluded_duplicate_repost: 0
    };

    // Database-computed statistics scoped strictly to requested cohort
    // Unresolved cohorts (< 2 qualified observations) return stats = null with explicit explanation
    let scopedStats = null;
    let statsExplanation = null;
    const exactCohortRequested = Boolean(
      brandQuery
      && (referenceQuery || modelQuery)
      && dialQuery.supplied
      && conditionQuery.supplied
    );
    if (exactCohortRequested) {
      const { data: statsRows, error: statsErr } = await supabase.rpc("get_price_research_scoped_stats_v2", {
        p_brand: brandQuery,
        p_reference: referenceQuery,
        p_model: modelQuery,
        p_dial_color: dialQuery.value,
        p_condition: conditionQuery.value
      });

      if (statsErr) throw statsErr;
      if (statsRows && statsRows.length > 0) {
        const s = statsRows[0];
        const count = parseInt(s.qualified_count, 10);
        const q1 = parseFloat(s.q1_price);
        const median = parseFloat(s.median_price);
        const q3 = parseFloat(s.q3_price);
        const iqr = parseFloat(s.iqr);
        const lowerFence = parseFloat(s.lower_fence);
        const upperFence = parseFloat(s.upper_fence);
        const multiplier = parseFloat(s.iqr_multiplier);

        if (count >= 2) {
          const invariantsValid =

            q1 <= median &&
            median <= q3 &&
            Math.abs(iqr - (q3 - q1)) <= 0.05 &&
            Math.abs(lowerFence - Math.max(0, q1 - 3.0 * iqr)) <= 0.05 &&
            Math.abs(upperFence - (q3 + 3.0 * iqr)) <= 0.05 &&
            lowerFence <= upperFence &&
            multiplier === 3.0;

          if (!invariantsValid) {
            throw new Error("PRICE_RESEARCH_INVARIANT_VIOLATION: Database returned inconsistent statistical invariants.");
          }

          scopedStats = {
            count: count,
            qualified_count: count,
            avg: parseFloat(s.avg_price),
            min: parseFloat(s.min_price),
            max: parseFloat(s.max_price),
            median: median,
            q1: q1,
            q3: q3,
            iqr: iqr,
            lower_fence: lowerFence,
            upper_fence: upperFence,
            iqr_multiplier: multiplier,
            multiplier: multiplier
          };
        } else {
          scopedStats = null;
          statsExplanation = `Fewer than 2 qualified observations exist for this exact cohort (${count} found). At least 2 verified observations are required to compute market statistics.`;
        }
      } else {
        scopedStats = null;
        statsExplanation = "No verified observations found for this exact cohort.";
      }
    } else {
      scopedStats = null;
      if (!conditionQuery.supplied || conditionQuery.value === null) {
        statsExplanation = "Condition cohort is unresolved. Select an exact condition (e.g. Unworn, Mint, Excellent) to view verified cohort statistics.";
      } else if (!dialQuery.supplied || dialQuery.value === null) {
        statsExplanation = "Dial color cohort is unresolved. Select an exact dial color to view verified cohort statistics.";
      } else if (!brandQuery) {
        statsExplanation = "Brand is required to compute verified cohort statistics.";
      } else {
        statsExplanation = "Exact cohort parameters (brand, reference/model, dial color, condition) are required to compute verified cohort statistics.";
      }
    }

    // 1. Fetch WTS listings via snapshot-pinned keyset RPC
    const { data: wtsData, error: wtsError } = await supabase.rpc("get_price_research_canary_keyset_v4", {
      p_snapshot_id: snapshotId,
      p_limit: limit,
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied,
      p_condition: conditionQuery.supplied ? conditionQuery.value : null,
      p_filter_condition: conditionQuery.supplied,
      p_cursor_priced_rank: parsedCursor ? parsedCursor.key.pricedRank : null,
      p_cursor_image_rank: parsedCursor ? parsedCursor.key.imageRank : null,
      p_cursor_price_usd: parsedCursor ? parsedCursor.key.priceUsd : null,
      p_cursor_created_at: parsedCursor ? parsedCursor.key.createdAt : null,
      p_cursor_listing_id: parsedCursor ? parsedCursor.key.listingId : null
    });
    if (wtsError) {
      const cursorFault = mapSnapshotRpcError(wtsError);
      if (cursorFault) throw cursorFault;
      throw wtsError;
    }
    // Order assertion compares the FROZEN membership columns (k_*).
    assertKeysetOrder(wtsData || []);

    // Display items come from the FROZEN snapshot payload; cursor keys never do.
    const items = (wtsData || []).map((row) => {
      // STRICT V2 ONLY: canary endpoint — fail closed on missing/partial/malformed provenance.
      const canonical = enforceListingDisplayContract((row && row.payload) || {});
      if (canonical.raw_message_text) canonical.raw_message_text = redactPublicSource(canonical.raw_message_text);
      if (canonical.source_context_text) canonical.source_context_text = redactPublicSource(canonical.source_context_text);
      if (canonical.description) canonical.description = redactPublicSource(canonical.description);
      return canonical;
    });

    // Phase 5.1: the next cursor is built ONLY from the frozen snapshot membership
    // columns (k_*) of the last raw row — never from display payload fields.
    const nextCursor = items.length === limit
      ? encodeCursorEnvelope({ snapshot: snapshotId, scope: cursorScope, frozenKey: wtsData[wtsData.length - 1] })
      : null;

    // 2. Fetch WTB demand evidence via the Phase 5.2 snapshot keyset RPC
    // (OFFSET-free; demand rows are members of TRADING FLOOR snapshots, so the
    // demand lane opens/reuses its own trading_floor snapshot — never the WTS one).
    const { data: wtbRpcData, error: wtbRpcErr } = await supabase.rpc("get_price_research_wtb_demand_v3", {
      p_snapshot_id: demandSnapshotId,
      p_limit: demandPageSize,
      p_brand: brandQuery,
      p_reference: referenceQuery,
      p_model: modelQuery,
      p_dial_color: dialQuery.supplied ? dialQuery.value : null,
      p_filter_dial: dialQuery.supplied,
      p_condition: conditionQuery.supplied ? conditionQuery.value : null,
      p_filter_condition: conditionQuery.supplied,
      p_cursor_priced_rank: parsedDemandCursor ? parsedDemandCursor.key.pricedRank : null,
      p_cursor_image_rank: parsedDemandCursor ? parsedDemandCursor.key.imageRank : null,
      p_cursor_price_usd: parsedDemandCursor ? parsedDemandCursor.key.priceUsd : null,
      p_cursor_created_at: parsedDemandCursor ? parsedDemandCursor.key.createdAt : null,
      p_cursor_listing_id: parsedDemandCursor ? parsedDemandCursor.key.listingId : null
    });
    if (wtbRpcErr) {
      const cursorFault = mapSnapshotRpcError(wtbRpcErr);
      if (cursorFault) throw cursorFault;
      throw wtbRpcErr;
    }
    // Demand lane order: frozen k_source_created_at DESC, k_listing_id ASC.
    assertDemandKeysetOrder(wtbRpcData || []);

    // Display rows come from the FROZEN snapshot payload; demand cursor keys never do.
    const demandRaw = (wtbRpcData || []).map((row) => (row && row.payload) || {});

    const demandItems = demandRaw.map((item) => {
      // STRICT V2 ONLY: canary endpoint — fail closed on missing/partial/malformed provenance.
      const canonical = enforceListingDisplayContract(item);
      if (canonical.raw_message_text) canonical.raw_message_text = redactPublicSource(canonical.raw_message_text);
      if (canonical.source_context_text) canonical.source_context_text = redactPublicSource(canonical.source_context_text);
      if (canonical.description) canonical.description = redactPublicSource(canonical.description);
      return canonical;
    });

    // Demand next cursor: built ONLY from the frozen k_* membership columns.
    const nextDemandCursor = (wtbRpcData || []).length === demandPageSize
      ? encodeCursorEnvelope({ snapshot: demandSnapshotId, scope: demandScope, frozenKey: wtbRpcData[wtbRpcData.length - 1] })
      : null;

    // 3. Statistical outlier derivation: strictly WTS observations outside [lower_fence, upper_fence]
    // WTB listings are NEVER classified as statistical outliers!
    let includedRows = [];
    let outlierRows = [];
    if (scopedStats) {
      outlierRows = items.filter(i => i.intent === 'WTS' && i.price_usd !== null && (i.price_usd < scopedStats.lower_fence || i.price_usd > scopedStats.upper_fence));
      includedRows = items.filter(i => i.intent === 'WTS' && i.price_usd !== null && i.price_usd >= scopedStats.lower_fence && i.price_usd <= scopedStats.upper_fence);
    } else {
      includedRows = items.filter(i => i.intent === 'WTS');
      outlierRows = [];
    }

    return res.status(200).json({
      success: true,
      snapshot: snapshotId,
      snapshot_total: wtsTotalCount,
      brand: brandQuery,
      reference: referenceQuery,
      resolvedRef: referenceQuery,
      count: scopedStats ? scopedStats.count : 0,
      rawCount: wtsTotalCount,
      sampledListings: items.length,
      totalListings: Number(cohortBreakdown.total_listings || wtsTotalCount + wtbTotalCount),
      reference_listing_count: Number(cohortBreakdown.total_listings || wtsTotalCount + wtbTotalCount),
      wts_count: wtsTotalCount,
      wtb_count: wtbTotalCount,
      qualified_count: Number(cohortBreakdown.qualified_wts_count || (scopedStats ? scopedStats.count : 0)),
      retained_evidence_count: Number(cohortBreakdown.retained_audit_evidence_count || includedRows.length),
      excludedEvidenceCount: Math.max(0, Number(cohortBreakdown.total_listings || wtsTotalCount + wtbTotalCount) - Number(cohortBreakdown.retained_audit_evidence_count || includedRows.length)),
      outliersRemoved: Number(cohortBreakdown.iqr_outliers_count || outlierRows.length),
      excluded_counts: {
        not_wts: Number(cohortBreakdown.excluded_not_wts || 0),
        unresolved_currency: Number(cohortBreakdown.excluded_unresolved_currency || 0),
        ineligible_flag: Number(cohortBreakdown.excluded_ineligible_flag || 0),
        duplicate_repost: Number(cohortBreakdown.excluded_duplicate_repost || 0)
      },
      condition_counts: conditionCounts,
      conditions: Object.keys(conditionCounts),
      reconciliation: {
        wts_loaded_count: items.length,
        wts_qualified_count: includedRows.length
      },
      analytics_ready: Boolean(scopedStats && scopedStats.count >= 2),
      selected_cohort: {
        brand: brandQuery,
        reference: referenceQuery,
        dial_color: dialQuery.value,
        condition: conditionQuery.value
      },
      rows: includedRows,
      retained_rows: includedRows,
      outlier_rows: outlierRows,
      demand_rows: demandItems,
      demandCount: wtbTotalCount,
      dial_trends: [],
      demand_evidence: {
        total: wtbTotalCount,
        snapshot_total: wtbTotalCount,
        page_size: demandPageSize,
        snapshot: demandSnapshotId,
        cursor: demandCursorStr,
        next_cursor: nextDemandCursor,
        has_more: Boolean(nextDemandCursor)
      },
      evidence: {
        items: items,
        rows: includedRows,
        outlier_rows: outlierRows,
        total: wtsTotalCount,
        outliers_total: outlierRows.length,
        comparable_page_size: limit,
        cursor: cursorStr,
        next_cursor: nextCursor,
        has_more: Boolean(nextCursor)
      },
      cursor: cursorStr,
      next_cursor: nextCursor,
      has_more: Boolean(nextCursor),
      stats: scopedStats,
      summary: scopedStats,
      stats_explanation: statsExplanation,
      methodology: {
        formula: 'Q1 - 3.0 * IQR <= price <= Q3 + 3.0 * IQR',
        included_count: includedRows.length,
        excluded_count: outlierRows.length,
        statistical_outlier_count: outlierRows.length,
        plausibility_floor_usd: scopedStats ? scopedStats.lower_fence : null
      }
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
};
