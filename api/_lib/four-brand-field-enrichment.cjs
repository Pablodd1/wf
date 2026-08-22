"use strict";

const FOUR_BRANDS = new Set(["tudor", "omega", "cartier", "zenith"]);
const MISSING_MARKERS = new Set([
  "",
  "unknown",
  "unspecified",
  "not specified",
  "not provided",
  "reference only",
  "model not specified",
  "dial not specified",
  "condition not specified",
]);

function isFourBrand(brand) {
  return FOUR_BRANDS.has(
    String(brand || "")
      .trim()
      .toLowerCase(),
  );
}

function isMissing(value, brand = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    MISSING_MARKERS.has(normalized) ||
    (normalized &&
      normalized ===
        String(brand || "")
          .trim()
          .toLowerCase())
  );
}

function applyEffectiveEnrichment(row, overlay) {
  if (!row || !overlay || String(row.id) !== String(overlay.listing_id))
    return row;
  const brand = row.canonical_brand || row.brand_scope || row.brand;
  if (
    !isFourBrand(brand) ||
    String(brand).trim().toLowerCase() !==
      String(overlay.canonical_brand || "")
        .trim()
        .toLowerCase()
  )
    return row;

  const next = { ...row, field_enrichment_run_key: overlay.run_key || null };
  const currentModel = row.model || row.catalog_model;
  if (overlay.model && isMissing(currentModel, brand)) {
    next.model = overlay.model;
    next.catalog_model = overlay.model;
  }
  const currentReference =
    row.normalized_reference || row.public_reference || row.reference;
  if (overlay.reference && !String(currentReference || "").trim()) {
    next.normalized_reference = overlay.reference;
    next.public_reference = overlay.reference;
    next.reference_search_key = String(overlay.reference)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }
  if (
    overlay.dial_color &&
    isMissing(row.dial_color || row.catalog_dial, brand)
  ) {
    next.dial_color = overlay.dial_color;
    next.catalog_dial = overlay.dial_color;
  }
  if (overlay.condition && isMissing(row.condition, brand))
    next.condition = overlay.condition;

  const hasCurrentPrice =
    Number(
      row.verified_price_usd ||
        row.workbook_price_usd ||
        row.source_price_amount ||
        row.price_usd,
    ) > 0;
  if (!hasCurrentPrice && Number(overlay.price_usd) > 0) {
    const ownerAssumed = overlay.price_evidence_status === "OWNER_ASSUMED_USD";
    next.workbook_price_usd = Number(overlay.price_usd);
    next.source_price_amount = Number(
      overlay.source_price_amount || overlay.price_usd,
    );
    next.source_currency = overlay.source_currency || (ownerAssumed ? null : "USD");
    next.price_evidence_status = overlay.price_evidence_status;
    if (
      ["SOURCE_EXPLICIT_USD_USDT", "DATED_VERIFIED_FX"].includes(
        overlay.price_evidence_status,
      )
    ) {
      next.verified_price_usd = Number(overlay.price_usd);
      next.has_verified_usd_price = true;
      next.analytics_fx_rate = overlay.fx_rate || null;
      next.analytics_fx_source = overlay.fx_source || null;
      next.analytics_fx_date = overlay.fx_date || null;
    } else {
      // Owner-assumed USD is tracked and displayed, never independently qualified.
      next.verified_price_usd = null;
      next.has_verified_usd_price = false;
      next.price_evidence_status = "OWNER_ASSUMED_USD";
    }
  }
  return next;
}

function isMissingEffectiveRpcError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    status === 404 ||
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /could not find the function|function .* does not exist|schema cache/.test(text)
  );
}

async function loadEffectiveEnrichments(client, rows) {
  const ids = [
    ...new Set(
      (rows || [])
        .map((row) => String(row?.id || ""))
    .filter((id) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)),
    ),
  ].slice(0, 101);
  if (!ids.length) return rows || [];
  const { data, error } = await client.rpc(
    "qnsa_four_brand_effective_enrichments",
    {
      p_listing_ids: ids,
    },
  );
  if (error) {
    if (isMissingEffectiveRpcError(error)) return rows || [];
    throw error;
  }
  const byId = new Map(
    (data || []).map((value) => {
      const row = value?.row_data || value;
      return [String(row.listing_id), row];
    }),
  );
  return (rows || []).map((row) =>
    applyEffectiveEnrichment(row, byId.get(String(row.id))),
  );
}

async function loadEffectivePage(client, options = {}) {
  const brand = String(options.brand || "").trim();
  if (!isFourBrand(brand)) return [];
  const { data, error } = await client.rpc(
    "qnsa_four_brand_effective_page_rows",
    {
      ...effectiveFilterArgs(options),
      p_limit: Math.min(
        options.analytics === true ? 2500 : 101,
        Math.max(1, Number(options.limit) || 51),
      ),
      p_offset: Math.max(0, Number(options.offset) || 0),
    },
  );
  if (error) {
    if (isMissingEffectiveRpcError(error)) return null;
    throw error;
  }
  return (data || []).map((value) => value?.row_data || value).filter(Boolean);
}

function effectiveFilterArgs(options = {}) {
  return {
    p_brand: String(options.brand || "").trim(),
    p_listing_type: options.listingType || null,
    p_model: options.model || null,
    p_reference: options.reference || null,
    p_dial: options.dial || null,
    p_condition: options.condition || null,
    p_search: options.search || null,
    p_references: Array.isArray(options.references) && options.references.length
      ? options.references
      : null,
    p_images_only: options.imagesOnly === true,
    p_priced_only: options.pricedOnly === true,
    p_posted_after: options.postedAfter || null,
    p_region: options.region || null,
    p_rating: options.rating || null,
  };
}

async function loadEffectiveCount(client, options = {}) {
  const brand = String(options.brand || "").trim();
  if (!isFourBrand(brand)) return 0;
  const { data, error } = await client.rpc(
    "qnsa_four_brand_effective_row_count",
    effectiveFilterArgs(options),
  );
  if (error) {
    if (isMissingEffectiveRpcError(error)) return null;
    throw error;
  }
  const count = Number(data);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Invalid four-brand effective count response");
  return count;
}

async function loadEffectiveDetail(client, listingId) {
  const id = String(listingId || "").trim();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    return { installed: true, fourBrandScope: false, row: null };
  const { data, error } = await client.rpc(
    "qnsa_four_brand_effective_detail",
    { p_listing_id: id },
  );
  if (error) {
    if (isMissingEffectiveRpcError(error)) return null;
    throw error;
  }
  return {
    installed: true,
    fourBrandScope: data?.four_brand_scope === true,
    row: data?.row_data || null,
  };
}

module.exports = {
  FOUR_BRANDS,
  isFourBrand,
  isMissing,
  applyEffectiveEnrichment,
  isMissingEffectiveRpcError,
  loadEffectiveEnrichments,
  loadEffectivePage,
  loadEffectiveCount,
  loadEffectiveDetail,
};
