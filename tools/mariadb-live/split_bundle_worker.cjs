"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { normalizeCanonicalParentChild, sha256 } = require("./authoritative-evidence-normalizer.cjs");

function processBundles(inputFile, outputFile) {
  const rawData = fs.readFileSync(inputFile, "utf-8");
  const bundleParents = JSON.parse(rawData);

  const splitResults = [];

  for (let i = 0; i < bundleParents.length; i++) {
    const parentRow = bundleParents[i];
    try {
      const { parent, children } = normalizeCanonicalParentChild(parentRow);
      
      if (children && children.length >= 2) {
        const mappedChildren = children.map((c, idx) => {
          const childIndex = c.child_ordinal !== undefined ? c.child_ordinal : idx;
          const childRef = c.reference || null;
          const childEvidenceHash = sha256(`${parentRow.source_id}_${childIndex}_${childRef || c.raw_line || ""}`);
          // Requirement 5: child_listing_id includes parent_source_id + child_index + child_evidence_hash
          const childListingId = `${parentRow.source_id}_child_${childIndex}_${childEvidenceHash.slice(0, 8)}`;

          // Requirement 5: Never default trading_floor_status to ELIGIBLE_WTS or trading_floor_eligible to true
          const childIntent = c.intent || parentRow.intent || null;
          let childTfStatus = "HELD_INTENT_UNKNOWN";
          let childTfEligible = false;
          let childIntentStatus = "INTENT_UNCONFIRMED";

          if (childIntent === "WTS") {
            childTfStatus = "ELIGIBLE_WTS";
            childTfEligible = true;
            childIntentStatus = "INTENT_CONFIRMED";
          } else if (childIntent === "WTB") {
            childTfStatus = "ELIGIBLE_WTB";
            childTfEligible = true;
            childIntentStatus = "INTENT_CONFIRMED";
          }

          // Requirement 7: Seller contact_available requires actual approved contact channel AND consent
          const sellerContactRaw = parentRow.seller_contact || null;
          const contactApproved = Boolean(parentRow.contact_publication_approved === true);
          const contactAvail = Boolean(sellerContactRaw && contactApproved);

          let sellerId = null;
          if (sellerContactRaw) {
            sellerId = sha256(`contact_${sellerContactRaw}`).slice(0, 16);
          } else if (parentRow.seller_name) {
            sellerId = sha256(`name_${parentRow.seller_name}`).slice(0, 16);
          }

          return {
            child_listing_id: childListingId,
            parent_source_id: parentRow.source_id,
            child_index: childIndex,
            child_evidence_hash: childEvidenceHash,
            source_system: parentRow.source_system,
            source_database: parentRow.source_database,
            source_table: parentRow.source_table,
            source_record_id: parentRow.source_record_id,
            source_created_on: parentRow.source_created_on,
            source_hash: parentRow.source_hash,
            brand: c.brand || parentRow.brand || null,
            reference: childRef,
            model: c.model || parentRow.model || null,
            year: c.year || parentRow.year || null,
            condition: c.condition || parentRow.condition || null,
            intent: childIntent,
            intent_status: childIntentStatus,
            original_price_amount: c.original_price_amount,
            original_price_currency: c.original_price_currency,
            price_usd: c.price_usd,
            fx_rate: c.fx_rate,
            fx_source: c.fx_source,
            fx_date: c.fx_date,
            currency_status: c.currency_status || "MISSING_PRICE",
            seller_id: sellerId,
            seller_name: parentRow.seller_name || null,
            seller_contact: sellerContactRaw,
            contact_available: contactAvail,
            image_key: c.primary_image_key || null,
            image_evidence_type: c.primary_image_evidence_type || "NO_IMAGE_CHILD_UNLINKED",
            trading_floor_status: childTfStatus,
            trading_floor_eligible: childTfEligible,
            price_research_status: c.price_research_status || (c.price_usd ? "ELIGIBLE_VERIFIED_USD" : "INELIGIBLE_MISSING_PRICE"),
            price_research_eligible: Boolean(c.price_research_eligible),
            is_bundle: false,
            included_in_statistics: Boolean(c.price_research_eligible),
            source_context_text: c.raw_line || parentRow.listing_text_evidence || "",
            listing_text_sha256: sha256(c.raw_line || parentRow.listing_text_evidence || ""),
            reconciliation_category: c.reconciliation_category || "NORMALIZED_PROPOSAL",
            review_flags: c.review_flags || ["BUNDLE_CHILD_SPLIT"],
            exclusion_reasons: c.exclusion_reasons || [],
            raw_payload: parentRow.raw_payload || {}
          };
        });

        splitResults.push({ parent_source_id: parentRow.source_id, split_status: "SUCCESSFULLY_SPLIT", children: mappedChildren });
      } else {
        splitResults.push({ parent_source_id: parentRow.source_id, split_status: "UNRESOLVED_BUNDLE", candidate_count: children ? children.length : 1, children: [] });
      }
    } catch (err) {
      splitResults.push({ parent_source_id: parentRow.source_id, split_status: "ERROR", error: err.message, children: [] });
    }
  }

  fs.writeFileSync(outputFile, JSON.stringify(splitResults), "utf-8");
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  processBundles(args[0], args[1]);
} else {
  console.error("Usage: node split_bundle_worker.cjs <input_json> <output_json>");
  process.exit(1);
}
