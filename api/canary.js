"use strict";

const tradingFloorHandler = require("./canary/trading-floor");
const priceResearchHandler = require("./canary/price-research");

module.exports = async function handler(req, res) {
  const url = req.url || "";
  if (url.includes("trading-floor")) {
    return tradingFloorHandler(req, res);
  } else if (url.includes("price-research")) {
    return priceResearchHandler(req, res);
  }
  return res.status(404).json({ error: "Canary endpoint not found" });
};
