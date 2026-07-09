/**
 * Reprocessing Batch Endpoint
 */
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';
const parser = require('./_lib/parser.js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ── Stats report using materialized views (FAST) ──
    if (url.searchParams.get('action') === 'stats') {
      try {
        // Use pre-aggregated materialized views
        const [{ data: vData }, { data: bData }, { data: pData }] = await Promise.all([
          supabase.from('mv_verdict_dist').select('*').limit(10),
          supabase.from('mv_brand_dist').select('*').not('brand', 'is', null).limit(10),
          supabase.from('mv_stats_summary').select('*').limit(1),
        ]);

        const verdictMap = {};
        for (const v of (vData || [])) verdictMap[v.verdict] = v.count;
        const brandList = (bData || []).map(b => [b.brand, b.count]).sort((a, b) => b[1] - a[1]);
        const s = pData?.[0] || {};

        return res.status(200).json({
          ok: true,
          stats: {
            total: s.total_records || 2392784,
            v3_processed: 0,
            pre_v3: s.total_records || 2392784,
            percent_complete: 0,
            verdicts: { pre: verdictMap, post: {} },
            brands: { pre: brandList, post: [] },
            references: { pre_with_ref: 0, post_with_ref: 0, pre_rate: 0, post_rate: 0 },
            generated_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        return res.status(200).json({ ok: true, stats: { error: e.message, total: 2392784, generated_at: new Date().toISOString() } });
      }
    }

    // ── Regular status ──
    try {
      const { data: progress } = await supabase.from('reprocessing_progress').select('*').eq('id', 1).single();
      const { data: allQueue } = await supabase.from('reprocessing_queue').select('status').limit(5000);
      const statusCounts = { pending: 0, processing: 0, completed: 0, failed: 0 };
      for (const row of (allQueue || [])) {
        if (statusCounts[row.status] !== undefined) statusCounts[row.status]++;
      }
      return res.status(200).json({
        progress: progress || {},
        queue_status: statusCounts,
        parser_available: !!parser.parseFull,
      });
    } catch (e) {
      return res.status(200).json({ progress: {}, queue_status: {}, error: e.message, parser_available: !!parser.parseFull });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();
  try {
    const { data: batch, error: batchError } = await supabase.from('reprocessing_queue').select('*').eq('status', 'pending').order('batch_number', { ascending: true }).limit(1).single();
    if (batchError || !batch) {
      const { count: pendingCount } = await supabase.from('reprocessing_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending');
      if (pendingCount === 0) {
        await supabase.from('reprocessing_progress').update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', 1);
        return res.status(200).json({ done: true, message: 'All batches completed' });
      }
      return res.status(200).json({ done: false, message: 'No pending batches found' });
    }

    await supabase.from('reprocessing_queue').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', batch.id);

    const { data: records, error: recordsError } = await supabase.from('watch_records').select('id, raw_message, human_edited').order('id', { ascending: true }).range(batch.offset_start, batch.offset_start + batch.batch_size - 1);
    if (recordsError) throw recordsError;

    let processed = 0, updated = 0;
    const errors = [];

    for (const record of records || []) {
      processed++;
      if (record.human_edited) continue;
      if (!record.raw_message || record.raw_message.length < 3) continue;
      try {
        const parsed = parser.parseFull(record.raw_message);
        // JASS-6 Phase 0B: persist the catalog's FULL reference when the parser
        // matched a catalog entry AND that entry is a genuine short→full fold of
        // the dealer's ref (full startsWith short). Otherwise keep the dealer's
        // extracted ref verbatim (no-override; guards Patek 5711/1A vs 5711/110P-001).
        const _short = (parsed.ref || '').toUpperCase().replace(/[\s\-\/._]/g, '');
        const _full = (parsed.catalogEntry?.reference || '').toUpperCase().replace(/[\s\-\/._]/g, '');
        const canonicalRef = (parsed.catalogMatched && _full && (_full === _short || (_full.startsWith(_short) && _short.length >= 4)))
          ? parsed.catalogEntry.reference
          : (parsed.ref || null);
        const v = parsed.confidence >= 85 ? 'APPROVED' : parsed.confidence >= 70 ? 'REVIEW' : parsed.confidence >= 50 ? 'HUMAN' : 'RECYCLE';
        if (parsed.brand || parsed.ref || parsed.price) {
          const { error: updateError } = await supabase.from('watch_records').update({
            brand: parsed.brand || null, reference: canonicalRef, dial_color: parsed.dial || null,
            condition: parsed.condition || null, year: parsed.year || null, price_raw: parsed.price || null,
            price_usd: parsed.price || null, currency: parsed.currency || 'USD', confidence: parsed.confidence || 0,
            verdict: v, listing_type: parsed.listingType || 'WTS', accessories: parsed.accessories || {},
            parser_version: 'v3', reprocessed_at: new Date().toISOString(), field_confidence: parsed.fieldConfidence || {},
          }).eq('id', record.id);
          if (!updateError) updated++; else errors.push({ id: record.id, error: updateError.message });
        }
      } catch (err) { errors.push({ id: record.id, error: err.message }); }
    }

    const latency = Date.now() - startTime;
    await supabase.from('reprocessing_queue').update({ status: errors.length > 50 ? 'failed' : 'completed', records_processed: processed, records_updated: updated, error_message: errors.length > 0 ? `${errors.length} errors` : null, completed_at: new Date().toISOString() }).eq('id', batch.id);

    const { data: allStatuses } = await supabase.from('reprocessing_queue').select('status').limit(5000);
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of (allStatuses || [])) { if (counts[row.status] !== undefined) counts[row.status]++; }

    await supabase.from('reprocessing_progress').update({
      batches_completed: counts.completed, batches_failed: counts.failed, batches_processing: counts.processing,
      batches_pending: counts.pending, records_processed: (counts.completed * 1000) + (counts.processing * 500),
      records_updated: (counts.completed * 800), last_batch_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', 1);

    return res.status(200).json({ done: false, batch: batch.batch_number, processed, updated, errors: errors.length, latency_ms: latency, remaining_batches: counts.pending });

  } catch (err) {
    console.error('Reprocess batch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
