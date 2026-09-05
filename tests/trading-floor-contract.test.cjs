const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('@supabase/supabase-js');

test('Trading Floor API Database Contract', async (t) => {
    if (process.env.RUN_LIVE_SUPABASE_TESTS !== '1') {
        t.skip('Skipping live Supabase tests (RUN_LIVE_SUPABASE_TESTS != 1)');
        return;
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        assert.fail('Supabase environment variables are missing (SUPABASE_URL, SUPABASE_ANON_KEY)');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    await t.test('Required API columns must be present', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('*')
            .limit(1);
        
        if (error) assert.fail(`Query failed: ${error.message}`);
        
        if (!data || data.length === 0) return;
        
        const row = data[0];
        const requiredColumns = [
            'id', 'parent_id', 'source_file', 'source_row_number', 'source_record_id',
            'posting_date', 'seller_name', 'seller_phone', 'contact_publication_approved',
            'raw_message', 'listing_type', 'brand_scope', 'supplied_brand',
            'canonical_brand', 'model', 'catalog_model', 'raw_reference',
            'normalized_reference', 'catalog_reference', 'dial_color', 'catalog_dial',
            'condition', 'workbook_price_usd', 'source_price_amount', 'source_currency',
            'price_evidence_status', 'confidence', 'verdict', 'verification_status',
            'user_image_url', 'imported_at', 'has_exact_source_image', 'verified_price_usd',
            'has_verified_usd_price', 'has_complete_identity', 'trading_floor_status',
            'reference_search_key'
        ];

        for (const col of requiredColumns) {
            assert.ok(Object.prototype.hasOwnProperty.call(row, col), `Missing required column: ${col}`);
        }
    });

    await t.test('A published bundle parent must NOT be exposed', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('id')
            .eq('is_bundle', true)
            .is('parent_id', null)
            .limit(1);
        
        if (error) assert.fail(`Query failed: ${error.message}`);
        assert.strictEqual(data.length, 0, 'Found an unresolved bundle parent exposed on the Trading Floor');
    });

    await t.test('A pending bundle child must NOT be exposed', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('id')
            .eq('trading_floor_status', 'bundle_child_pending_review')
            .limit(1);
            
        if (error) assert.fail(`Query failed: ${error.message}`);
        assert.strictEqual(data.length, 0, 'Found a pending bundle child exposed on the Trading Floor');
    });

    await t.test('An exact duplicate must NOT be exposed', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('id')
            .eq('trading_floor_status', 'suppressed_exact_duplicate')
            .limit(1);
            
        if (error) assert.fail(`Query failed: ${error.message}`);
        assert.strictEqual(data.length, 0, 'Found an exact duplicate exposed on the Trading Floor');
    });

    await t.test('A separated child must hide its images completely', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('front_image, image_url, user_image_url, thumbnail_url, display_image_url, image_urls, storage_key, attachment_keys, mime_type, has_exact_source_image, has_images, image_url_resolvable, visually_verified')
            .not('parent_id', 'is', null)
            .limit(50);
            
        if (error) assert.fail(`Query failed: ${error.message}`);
        
        for (const row of data) {
            assert.ok(!row.front_image, 'front_image must be null');
            assert.ok(!row.image_url, 'image_url must be null');
            assert.ok(!row.user_image_url, 'user_image_url must be null');
            assert.ok(!row.thumbnail_url, 'thumbnail_url must be null');
            assert.ok(!row.display_image_url, 'display_image_url must be null');
            assert.ok(!row.storage_key, 'storage_key must be null');
            assert.ok(!row.mime_type, 'mime_type must be null');
            assert.strictEqual(row.has_exact_source_image, false, 'has_exact_source_image must be false');
            assert.strictEqual(row.has_images, false, 'has_images must be false');
            assert.strictEqual(row.image_url_resolvable, false, 'image_url_resolvable must be false');
            assert.strictEqual(row.visually_verified, false, 'visually_verified must be false');
            
            if (row.image_urls) {
                if (Array.isArray(row.image_urls)) {
                    assert.strictEqual(row.image_urls.length, 0, 'image_urls must be empty array');
                } else if (typeof row.image_urls === 'string') {
                    assert.strictEqual(row.image_urls, '[]', 'image_urls must be empty JSON array string');
                }
            }
            if (row.attachment_keys) {
                if (Array.isArray(row.attachment_keys)) {
                    assert.strictEqual(row.attachment_keys.length, 0, 'attachment_keys must be empty array');
                } else if (typeof row.attachment_keys === 'string') {
                    assert.strictEqual(row.attachment_keys, '[]', 'attachment_keys must be empty JSON array string');
                }
            }
        }
    });

    await t.test('Verified-image listings must rank ahead of image-less listings', async () => {
        const { data, error } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('has_exact_source_image')
            .order('has_exact_source_image', { ascending: false, nullsFirst: false })
            .limit(200);
            
        if (error) assert.fail(`Query failed: ${error.message}`);
        
        if (data.length > 0) {
            let transitionFound = false;
            for (let i = 0; i < data.length; i++) {
                if (!data[i].has_exact_source_image) {
                    transitionFound = true;
                } else {
                    assert.ok(!transitionFound, 'Found a verified-image record sorted after an image-less record');
                }
            }
        }
    });

    await t.test('WTB and WTS no-price listings should be visible', async () => {
        // Find if a valid source WTB/WTS no-price exists
        const { data: wtbSource, error: wtbError } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('id')
            .eq('intent', 'WTB')
            .is('workbook_price_usd', null)
            .limit(1);

        assert.strictEqual(wtbError, null, `WTB query error: ${wtbError?.message}`);
        assert.ok(wtbSource && wtbSource.length > 0, 'Expected at least one eligible public WTB no-price source.');

        const { data: wtsSource, error: wtsError } = await supabase
            .from('reviewed_workbook_market_source_v2')
            .select('id')
            .eq('intent', 'WTS')
            .is('workbook_price_usd', null)
            .limit(1);

        assert.strictEqual(wtsError, null, `WTS query error: ${wtsError?.message}`);
        assert.ok(wtsSource && wtsSource.length > 0, 'Expected at least one eligible public WTS no-price source.');
    });
});
