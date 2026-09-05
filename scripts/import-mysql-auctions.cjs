#!/usr/bin/env node
'use strict';

process.stderr.write([
  'This importer is disabled because it inferred currency, FX, condition and year,',
  'then wrote directly to watch_records without immutable raw staging.',
  'Use `npm run mariadb:collect`, followed by `npm run mariadb:normalize-local`.',
].join(' ') + '\n');
process.exitCode = 2;
