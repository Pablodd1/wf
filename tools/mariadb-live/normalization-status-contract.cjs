// tools/mariadb-live/normalization-status-contract.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const contractJsonPath = path.resolve(__dirname, 'normalization-status-contract.json');
const NORMALIZATION_STATUS_CONTRACT = Object.freeze(JSON.parse(fs.readFileSync(contractJsonPath, 'utf-8')));

module.exports = { NORMALIZATION_STATUS_CONTRACT };
