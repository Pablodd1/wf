/**
 * Reprocessing Batch Endpoint
 * Processes one batch of 1,000 records through parser v3
 * Triggered by cron job or manual request
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

// Import parser
const parser = require('./_lib/parser.js');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET = status/stats, POST = process one batch
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ── Stats report: /api/reprocess-batch?action=stats ──
    if (url.searchParams.get('action') === 'stats') {
      try {
        // v3 vs pre-v3 counts
        const { count: v3Count } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('parser_version', 'v3.0');
        const { count: preCount } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).neq('parser_version', 'v3.0');

        // Verdict distribution samples
        const { data: v3Sample } = await supabase.from('watch_records').select('verdict').eq('parser_version', 'v3.0').limit(5000);
        const { data: preSample } = await supabase.from('watch_records').select('verdict').neq('parser_version', 'v3.0').limit(5000);

        const v3Verdicts = {}; for (const r of (v3Sample || [])) v3Verdicts[r.verdict] = (v3Verdicts[r.verdict] || 0) + 1;
        const preVerdicts = {}; for (const r of (preSample || [])) preVerdicts[r.verdict] = (preVerdicts[r.verdict] || 0) + 1;

        // Reference extraction rates
        const { count: v3RefCount } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).eq('parser_version', 'v3.0').not('reference', 'is', null);
        const { count: preRefCount } = await supabase.from('watch_records').select('*', { count: 'exact', head: true }).neq('parser_version', 'v3.0').not('reference', 'is', null);

        // Brand distribution
        const { data: v3Brands } = await supabase.from('watch_records').select('brand').eq('parser_version', 'v3.0').not('brand', 'is', null).limit(5000);
        const { data: preBrands } = await supabase.from('watch_records').select('brand').neq('parser_version', 'v3.0').not('brand', 'is', null).limit(5000);
        const v3BrandMap = {}; for (const r of (v3Brands || [])) v3BrandMap[r.brand] = (v3BrandMap[r.brand] || 0) + 1;
        const preBrandMap = {}; for (const r of (preBrands || [])) preBrandMap[r.brand] = (preBrandMap[r.brand] || 0) + 1;

        const total = (v3Count || 0) + (preCount || 0);

        return res.status(200).json({
          ok: true,
          stats: {
            total,
            v3_processed: v3Count || 0,
            pre_v3: preCount || 0,
            percent_complete: total > 0 ? Math.round(((v3Count || 0) / total) * 100) : 0,
            verdicts: { pre: preVerdicts, post: v3Verdicts },
            brands: {
              pre: Object.entries(preBrandMap).sort((a, b) => b[1] - a[1]).slice(0, 10),
              post: Object.entries(v3BrandMap).sort((a, b) => b[1] - a[1]).slice(0, 10),
            },
            references: {
              pre_with_ref: preRefCount || 0,
              post_with_ref: v3RefCount || 0,
              pre_rate: preCount > 0 ? Math.round(((preRefCount || 0) / preCount) * 100) : 0,
              post_rate: v3Count > 0 ? Math.round(((v3RefCount || 0) / v3Count) * 100) : 0,
            },
            generated_at: new Date().toISOString(),
          },
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // ── Regular status ──
    const { data: progress } = await supabase
      .from('reprocessing_progress')
      .select('*')
      .eq('id', 1)
      .single();

    const { data: recent } = await supabase
      .from('reprocessing_queue')
      .select('status, count(*)')
      .group('status');

    return res.status(200).json({
      progress: progress || {},
      queue_status: recent || [],
      parser_available: !!parser.parseFull,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    // 1. Get next pending batch
    const { data: batch, error: batchError } = await supabase
      .from('reprocessing_queue')
      .select('*')
      .eq('status', 'pending')
      .order('batch_number', { ascending: true })
      .limit(1)
      .single();

    if (batchError || !batch) {
      // Check if all done
      const { count: pendingCount } = await supabase
        .from('reprocessing_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (pendingCount === 0) {
        await supabase.from('reprocessing_progress').update({ 
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', 1);
        return res.status(200).json({ done: true, message: 'All batches completed' });
      }
      return res.status(200).json({ done: false, message: 'No pending batches found' });
    }

    // 2. Mark batch as processing
    await supabase.from('reprocessing_queue').update({
      status: 'processing',
      started_at: new Date().toISOString(),
    }).eq('id', batch.id);

    // 3. Fetch records for this batch
    const { data: records, error: recordsError } = await supabase
      .from('watch_records')
      .select('id, raw_message, human_edited')
      .order('id', { ascending: true })
      .range(batch.offset_start, batch.offset_start + batch.batch_size - 1);

    if (recordsError) throw recordsError;

    let processed = 0;
    let updated = 0;
    const errors = [];

    // 4. Process each record
    for (const record of records || []) {
      processed++;
      
      // Skip human-edited records
      if (record.human_edited) continue;
      
      // Skip records without raw_message
      if (!record.raw_message || record.raw_message.length < 3) continue;

      try {
        const parsed = parser.parseFull(record.raw_message);
        
        // Calculate confidence
        let confidence = parsed.confidence || 0;
        const verdict = parsed.confidence >= 85 ? 'APPROVED' : 
                       parsed.confidence >= 70 ? 'REVIEW' : 
                       parsed.confidence >= 50 ? 'HUMAN' : 'RECYCLE';

        // Only update if we got meaningful data
        if (parsed.brand || parsed.ref || parsed.price) {
          const { error: updateError } = await supabase
            .from('watch_records')
            .update({
              brand: parsed.brand || null,
              reference: parsed.ref || null,
              dial_color: parsed.dial || null,
              condition: parsed.condition || null,
              year: parsed.year || null,
              price_raw: parsed.price || null,
              price_usd: parsed.price || null,
              currency: parsed.currency || 'USD',
              confidence: confidence,
              verdict: verdict,
              listing_type: parsed.listingType || 'WTS',
              accessories: parsed.accessories || {},
              parser_version: 'v3',
              reprocessed_at: new Date().toISOString(),
              field_confidence: parsed.fieldConfidence || {},
            })
            .eq('id', record.id);

          if (!updateError) updated++;
          else errors.push({ id: record.id, error: updateError.message });
        }
      } catch (err) {
        errors.push({ id: record.id, error: err.message });
      }
    }

    // 5. Mark batch as completed
    const latency = Date.now() - startTime;
    await supabase.from('reprocessing_queue').update({
      status: errors.length > 50 ? 'failed' : 'completed',
      records_processed: processed,
      records_updated: updated,
      error_message: errors.length > 0 ? `${errors.length} errors` : null,
      completed_at: new Date().toISOString(),
    }).eq('id', batch.id);

    // 6. Update overall progress
    const { data: counts } = await supabase
      .from('reprocessing_queue')
      .select('status, count(*)')
      .group('status');

    const completed = counts?.find(c => c.status === 'completed')?.count || 0;
    const failed = counts?.find(c => c.status === 'failed')?.count || 0;
    const processing = counts?.find(c => c.status === 'processing')?.count || 0;

    await supabase.from('reprocessing_progress').update({
      batches_completed: completed,
      batches_failed: failed,
      batches_processing: processing,
      batches_pending: 2393 - completed - failed - processing,
      records_processed: (completed * 1000) + (processing * 500),
      records_updated: (completed * 800),
      last_batch_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', 1);

    return res.status(200).json({
      done: false,
      batch: batch.batch_number,
      processed,
      updated,
      errors: errors.length,
      latency_ms: latency,
      remaining_batches: 2393 - completed - failed - processing,
    });

  } catch (err) {
    console.error('Reprocess batch error:', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
};
