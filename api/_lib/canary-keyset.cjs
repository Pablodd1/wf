"use strict";

const CURSOR_VERSION = "v2";

function rankListing(item) {
  const pricedRank = Number.isInteger(Number(item.priced_rank))
    ? Number(item.priced_rank)
    : (item.price_research_eligible === true && Number(item.price_usd) > 0 ? 1 : 2);
  const imageRank = Number.isInteger(Number(item.image_rank))
    ? Number(item.image_rank)
    : (
      item.image_status === "SOURCE_IMAGE_PRESENT"
      && typeof item.image_key === "string"
      && item.image_key.trim() !== ""
        ? 1
        : 2
    );

  return { pricedRank, imageRank };
}

function encodeKeysetCursor(item) {
  if (!item) return null;
  const { pricedRank, imageRank } = rankListing(item);
  const priceUsd = item.price_usd === null || item.price_usd === undefined
    ? null
    : Number(item.price_usd);
  const createdAt = item.source_created_at
    ? new Date(item.source_created_at).toISOString()
    : null;
  const listingId = typeof item.listing_id === "string" ? item.listing_id.trim() : "";

  if (![1, 2].includes(pricedRank) || ![1, 2].includes(imageRank)) {
    throw new TypeError("Cannot encode cursor with invalid rank values");
  }
  if (priceUsd !== null && !Number.isFinite(priceUsd)) {
    throw new TypeError("Cannot encode cursor with invalid USD price");
  }
  if (!createdAt || !listingId) {
    throw new TypeError("Cannot encode cursor without timestamp and listing ID");
  }

  return Buffer.from(
    JSON.stringify([CURSOR_VERSION, pricedRank, imageRank, priceUsd, createdAt, listingId]),
    "utf-8"
  ).toString("base64url");
}

function decodeKeysetCursor(cursor) {
  if (!cursor) return null;
  let tuple;
  try {
    tuple = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    throw new TypeError("Malformed cursor");
  }

  if (!Array.isArray(tuple) || tuple.length !== 6 || tuple[0] !== CURSOR_VERSION) {
    throw new TypeError("Unsupported cursor version or tuple shape");
  }

  const [, pricedRank, imageRank, priceUsd, createdAt, listingId] = tuple;
  const timestamp = Date.parse(createdAt);
  if (
    ![1, 2].includes(pricedRank)
    || ![1, 2].includes(imageRank)
    || (priceUsd !== null && !Number.isFinite(priceUsd))
    || !Number.isFinite(timestamp)
    || typeof listingId !== "string"
    || listingId.trim() === ""
  ) {
    throw new TypeError("Invalid cursor tuple values");
  }
  if (pricedRank === 1 && priceUsd === null) {
    throw new TypeError("Priced cursor is missing USD price");
  }
  if (pricedRank === 2 && priceUsd !== null) {
    throw new TypeError("Unpriced cursor unexpectedly contains a USD price");
  }

  return { pricedRank, imageRank, priceUsd, createdAt, listingId };
}

function compareNullablePriceDesc(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/**
 * Mirrors the database order exactly. A positive value means `left` appears
 * after `right`, which is the keyset predicate used for the next page.
 */
function compareKeysetTuple(leftItem, rightItem) {
  const leftRanks = rankListing(leftItem);
  const rightRanks = rankListing(rightItem);
  const leftPrice = leftItem.price_usd == null ? null : Number(leftItem.price_usd);
  const rightPrice = rightItem.price_usd == null ? null : Number(rightItem.price_usd);
  const leftCreated = Date.parse(leftItem.source_created_at);
  const rightCreated = Date.parse(rightItem.source_created_at);
  const leftId = String(leftItem.listing_id || "");
  const rightId = String(rightItem.listing_id || "");

  return (
    leftRanks.pricedRank - rightRanks.pricedRank
    || leftRanks.imageRank - rightRanks.imageRank
    || compareNullablePriceDesc(leftPrice, rightPrice)
    || rightCreated - leftCreated
    || leftId.localeCompare(rightId)
  );
}

function isAfterCursor(item, cursor) {
  if (!cursor) return true;
  return compareKeysetTuple(item, {
    priced_rank: cursor.pricedRank,
    image_rank: cursor.imageRank,
    price_usd: cursor.priceUsd,
    source_created_at: cursor.createdAt,
    listing_id: cursor.listingId
  }) > 0;
}

function assertKeysetOrder(items) {
  for (let index = 1; index < items.length; index += 1) {
    if (compareKeysetTuple(items[index - 1], items[index]) > 0) {
      throw new TypeError(`Database returned records outside the required keyset order at index ${index}`);
    }
  }
}

module.exports = {
  CURSOR_VERSION,
  assertKeysetOrder,
  compareKeysetTuple,
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAfterCursor,
  rankListing
};
