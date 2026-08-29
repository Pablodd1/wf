'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260812033000_qnsa_trading_reference_rows.sql'),'utf8');
test('reference feed is single-item, usable-USD-first and source-backed',()=>{assert.match(sql,/parent_id IS NULL/);assert.match(sql,/COALESCE\(l\.is_bundle,false\)=false/);assert.match(sql,/suppressed_exact_duplicate/);assert.match(sql,/WITH eligible_ids AS MATERIALIZED/);assert.match(sql,/ORDER BY \(l\.price_usd >= 1000 AND/);assert.match(sql,/conversion_timestamp IS NOT NULL/);assert.match(sql,/raw_message_versions/);assert.match(sql,/raw_data,region/);assert.match(sql,/dealer_rating/);assert.match(sql,/text_pattern_ops/)});
test('reference feed keeps the exact lookup indexable',()=>{assert.match(sql,/l\.reference_normalized = p_reference/);assert.doesNotMatch(sql,/regexp_replace\(p_reference/)});
test('reference feed labels native USD and verified FX separately',()=>{assert.match(sql,/SOURCE_EXPLICIT_USD_MATCH/);assert.match(sql,/EXPLICIT_SOURCE_FX_CONVERTED/);assert.match(sql,/CURRENCY_UNCONFIRMED/)});
