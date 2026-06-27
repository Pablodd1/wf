'use strict';
// Sets env in-process before loading the CJS script
const path = require('path');
require(path.join(__dirname, 'reanalyze_batch.cjs'));
