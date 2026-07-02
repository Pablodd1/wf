/**
 * POST /api/catalog-normalize
 * 
 * Batch-normalize records using the catalog matcher.
 * Designed to run within Vercel's 60s timeout:
 * - Processes 500 records per call
 * - Any record with brand+ref in catalog → confidence=100, verdict=APPROVED
 * - Uses cursor-based pagination (id > lastId)
 * - Returns the next cursor so a cron job can chain calls
 * 
 * Usage:
 *   POST /api/catalog-normalize { lastId: null, batchSize: 500 }
 *   POST /api/catalog-normalize { lastId: "abc-123", batchSize: 500 }
 *   POST /api/catalog-normalize { resume: true }  // resumes from last checkpoint
 * 
 * Protected by ADMIN_KEY env var.
 */

const { getClient } = require('./_lib/supabase');
const { parseFull } = require('./_lib/parser');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth
  const adminKey = req.body?.admin_key || req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  try {
    const client = getClient();
    const { lastId, batchSize = 200, resume } = req.body || {};
    
    // If resume mode, read the last checkpoint from a metadata table
    let startId = lastId || null;
    if (resume && !lastId) {
      const { data: checkpoint } = await client
        .from('normalize_checkpoints')
        .select('last_id')
        .eq('job_name', 'catalog_normalize')
        .single();
      if (checkpoint) startId = checkpoint.last_id;
    }

    // Fetch batch with cursor pagination
    let query = client
      .from('watch_records')
      .select('id, brand, reference, raw_message, verdict, confidence')
      .order('id', { ascending: true })
      .limit(batchSize);

    if (startId) query = query.gt('id', startId);

    const { data: records, error: fetchError } = await query;
    if (fetchError) throw fetchError;
    if (!records || records.length === 0) {
      return res.status(200).json({
        done: true,
        processed: 0,
        updated: 0,
        message: 'No more records to process. Catalog normalization complete!'
      });
    }

    const nextId = records[records.length - 1].id;
    let updated = 0;
    let catalogMatched = 0;
    const batch = [];

    for (const record of records) {
      if (!record.raw_message) continue;
      
      const parsed = parseFull(record.raw_message);
      if (!parsed || !parsed.catalogMatched) continue;
      
      catalogMatched++;
      
      // Only update if verdict would change
      if (record.verdict === 'APPROVED' && record.confidence >= 100) continue;
      
      const update = {
        id: record.id,
        brand: parsed.brand,
        reference: parsed.ref,
        confidence: 100,
        verdict: 'APPROVED',
        parser_version: 'catalog-v1',
        reprocessed_at: new Date().toISOString()
      };
      
      if (parsed.price) update.price_usd = parsed.price;
      if (parsed.condition) update.condition = parsed.condition;
      if (parsed.year) update.year = parsed.year;
      if (parsed.dial) update.dial_color = parsed.dial;
      
      batch.push(update);
    }

    // Bulk upsert
    if (batch.length > 0) {
      const { error: upsertError } = await client
        .from('watch_records')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

      if (upsertError) {
        // Fallback: try individual updates
        for (const item of batch) {
          const { error: singleErr } = await client
            .from('watch_records')
            .update(item)
            .eq('id', item.id);
          if (!singleErr) updated++;
        }
      } else {
        updated = batch.length;
      }
    }

    // Save checkpoint
    await client
      .from('normalize_checkpoints')
      .upsert({
        job_name: 'catalog_normalize',
        last_id: nextId,
        processed_at: new Date().toISOString(),
        total_processed: 0,
        total_updated: 0
      }, { onConflict: 'job_name' });

    // Total progress: estimate from DB
    const { count: totalRecords } = await client
      .from('watch_records')
      .select('id', { count: 'exact', head: true })
      .limit(0);
    
    res.status(200).json({
      done: false,
      processed: records.length,
      catalogMatched,
      updated,
      nextId,
      progress: {
        batchSize: records.length,
        updatedInBatch: updated,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
