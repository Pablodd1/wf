"use strict";
const { createHash } = require("node:crypto");

function compareDiscovery(left, right) {
  const lane = Number(left.k_priced_rank) - Number(right.k_priced_rank)
    || Number(left.k_image_rank) - Number(right.k_image_rank);
  if (lane) return lane;
  const hash = value => createHash("md5").update(value).digest("hex");
  const a = hash(left.k_listing_id), b = hash(right.k_listing_id);
  return a < b ? -1 : a > b ? 1 : left.k_listing_id < right.k_listing_id ? -1 : left.k_listing_id > right.k_listing_id ? 1 : 0;
}

function assertDiscoveryOrder(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (compareDiscovery(rows[i - 1], rows[i]) >= 0) throw new TypeError("Database returned invalid discovery order");
  }
}

module.exports = { compareDiscovery, assertDiscoveryOrder };
