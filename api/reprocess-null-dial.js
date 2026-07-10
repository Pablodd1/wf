/**
 * /api/reprocess-null-dial — Re-process records with NULL dial_color through the fixed parser.
 * 
 * POST with admin_key to run. The parser now uses catalog.json as a dial-color fallback
 * when the raw_message text contains no color word but the reference is in the catalog.
 * 
 * Processes in batches to avoid Vercel 10s timeout.
 * Set ?limit=N to control batch size (default 200, max 1000).
 */
const { getClient } = require('./_lib/supabase');
const { parseFull } = require('./_lib/parser');
const { setCorsHeaders } = require('./_lib/cors');


const BATCH_SIZE = 500;

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin_key = req.method === 'POST' ? req.body?.admin_key : req.query?.key;
  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  const limit = Math.min(parseInt(req.query?.limit || req.body?.limit) || BATCH_SIZE, 1000);
  const dryRun = String(req.query?.dry_run ?? req.body?.dry_run ?? '').toLowerCase() === 'true';

  try {
    const client = getClient();

    // 1. Fetch records with NULL dial_color
    const { data: records, error: fetchErr } = await client
      .from('watch_records')
      .select('id, brand, reference, raw_message, dial_color')
      .is('dial_color', null)
      .order('id', { ascending: true })
      .limit(limit);

    if (fetchErr) throw fetchErr;

    if (!records || records.length === 0) {
      return res.status(200).json({ success: true, processed: 0, message: 'No NULL-dial records found' });
    }

    // 2. Re-parse each record and collect updates
    let filled = 0;
    let noChange = 0;
    let noMsg = 0;
    const updates = [];

    for (const record of records) {
      if (!record.raw_message) {
        noMsg++;
        continue;
      }

      const parsed = parseFull(record.raw_message);
      
      if (parsed.dial) {
        filled++;
        updates.push({
          id: record.id,
          dial_color: parsed.dial,
        });
      } else {
        noChange++;
      }
    }

    // 3. Batch update records that got a dial — skipped entirely in dry-run mode
    let updated = 0;
    if (!dryRun && updates.length > 0) {
      // Update in sub-batches of 200
      for (let i = 0; i < updates.length; i += 200) {
        const batch = updates.slice(i, i + 200);
        for (const u of batch) {
          const { error: updateErr } = await client
            .from('watch_records')
            .update({ dial_color: u.dial_color })
            .eq('id', u.id);
          
          if (updateErr) {
            console.error('Update error for', u.id, updateErr.message);
          } else {
            updated++;
          }
        }
      }
    }

    // 4. Sample: show what was filled (or would be filled, in dry-run)
    const samples = updates.slice(0, 10).map(u => ({
      ...u,
      // fetch the record's reference for context
    }));

    res.status(200).json({
      success: true,
      dry_run: dryRun,
      total: records.length,
      filled,
      noChange,
      noMsg,
      updated,
      samples: samples.slice(0, 10).map(u => ({ id: u.id, dial_color: u.dial_color })),
      // Full diff only in dry-run — every record that would get a dial filled
      diff: dryRun ? updates : undefined,
      message: dryRun
        ? `DRY RUN — would fill ${filled} of ${records.length} records (${Math.round(filled/records.length*100)}%). No writes were made. Review 'diff', then re-run with dry_run=false.`
        : `Filled ${filled} of ${records.length} records (${Math.round(filled/records.length*100)}%). Run again for next batch.`
    });

  } catch (err) {
    console.error('reprocess-null-dial error:', err);
    res.status(500).json({ error: err.message });
  }
};
