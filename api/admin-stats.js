/** ADMIN STATS — live production summary for the owner dashboard. */
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function plannedCount(client, configure) {
  let query = client.from('watch_records').select('id', { count: 'planned', head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function exactCount(client, table, configure) {
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function incomingPipelineStats(client) {
  let telegram;
  try {
    const [captured, readyForReview, processingErrors, reviewPending, approved, rejected, deferred, latest] = await Promise.all([
      exactCount(client, 'telegram_ingest_shadow_events'),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('processing_status', 'READY_FOR_REVIEW')),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('processing_status', 'ERROR')),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('review_status', 'PENDING')),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('review_status', 'APPROVED')),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('review_status', 'REJECTED')),
      exactCount(client, 'telegram_ingest_shadow_results', query => query.eq('review_status', 'DEFERRED')),
      client.from('telegram_ingest_shadow_events')
        .select('message_date,received_at')
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (latest.error) throw latest.error;
    telegram = {
      available: true,
      captured,
      readyForReview,
      processingErrors,
      reviewPending,
      approved,
      rejected,
      deferred,
      latestMessageAt: latest.data?.message_date || null,
      latestReceivedAt: latest.data?.received_at || null,
      customerRecordWrites: 0,
    };
  } catch {
    telegram = {
      available: false,
      captured: 0,
      readyForReview: 0,
      processingErrors: 0,
      reviewPending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      latestMessageAt: null,
      latestReceivedAt: null,
      customerRecordWrites: 0,
    };
  }

  let sources = [];
  try {
    const { data, error } = await client.from('source_pipeline_accountability')
      .select('source_key,source_platform,source_table,pipeline_status,observed_at,source_input_rows,immutable_raw_rows,normalization_proposal_rows,collection_error_rows,normalization_error_rows,source_reconciled,normalization_reconciled,parser_version,customer_record_writes')
      .order('observed_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    sources = data || [];
  } catch {
    sources = [];
  }

  return { telegram, sources };
}

async function lineageStats(client) {
  async function lineageCount(configure) {
    let query = client.from('seller_listing_lineage_staging').select('id', { count: 'planned', head: true });
    if (configure) query = configure(query);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  }
  const filters = [
    ['total', null],
    ['matchReady', query => query.eq('match_status', 'MATCH_READY')],
    ['reviewRequired', query => query.eq('match_status', 'REVIEW_REQUIRED')],
    ['applied', query => query.eq('match_status', 'APPLIED')],
    ['withName', query => query.not('observed_name', 'is', null)],
    ['withPhone', query => query.not('source_identity', 'is', null)],
    ['withOriginalDate', query => query.not('source_posted_at', 'is', null)],
    ['withImage', query => query.not('front_image', 'is', null)],
  ];
  try {
    const results = await Promise.all(filters.map(async ([key, configure]) => [
      key,
      await lineageCount(configure),
    ]));
    return { available: true, ...Object.fromEntries(results) };
  } catch {
    return { available: false, total: 0, matchReady: 0, reviewRequired: 0, applied: 0, withName: 0, withPhone: 0, withOriginalDate: 0, withImage: 0 };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });
  const client = authorization.client;

  try {
    const types = ['WTS', 'WTB', 'NTQ', 'TRADE', 'MULTI', 'OTHER'];
    const [totalRecords, approved, human, recycle, typeEstimates, sampleResult, patekRecords, patekWts, patekImages, sellerLineage, incoming] = await Promise.all([
      plannedCount(client),
      plannedCount(client, query => query.eq('verdict', 'APPROVED')),
      plannedCount(client, query => query.eq('verdict', 'HUMAN')),
      plannedCount(client, query => query.eq('verdict', 'RECYCLE')),
      Promise.all(types.map(async type => [type, await plannedCount(client, query => query.eq('listing_type', type))])),
      client.from('watch_records')
        .select('reference,price_usd,brand,dial_color,year,confidence,created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe')),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe').eq('verdict', 'APPROVED').eq('listing_type', 'WTS')),
      plannedCount(client, query => query.eq('brand', 'Patek Philippe').eq('has_images', true)),
      lineageStats(client),
      incomingPipelineStats(client),
    ]);
    if (sampleResult.error) throw sampleResult.error;

    const sample = sampleResult.data || [];
    const missing = value => value == null || String(value).trim() === '';
    const unknown = value => missing(value) || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA'].includes(String(value).trim().toUpperCase());
    const confidences = sample.map(row => Number(row.confidence)).filter(Number.isFinite);
    const typeCounts = Object.fromEntries(typeEstimates);

    // Planner estimates return 1 for an empty rare category. Confirm those
    // categories with a bounded existence lookup so the admin panel never
    // claims inventory that is not actually present.
    await Promise.all(types.filter(type => typeCounts[type] <= 1).map(async type => {
      const { data, error } = await client.from('watch_records').select('id').eq('listing_type', type).limit(1);
      if (error) throw error;
      typeCounts[type] = data?.length ? Math.max(1, typeCounts[type]) : 0;
    }));

    return res.status(200).json({
      success: true,
      countsEstimated: true,
      totalRecords,
      approved,
      human,
      recycle,
      typeCounts,
      patek: { records: patekRecords, approvedWts: patekWts, imageBacked: patekImages, countsEstimated: true },
      sellerLineage,
      incoming,
      qualitySampleSize: sample.length,
      missingRef: sample.filter(row => missing(row.reference)).length,
      missingPrice: sample.filter(row => !Number.isFinite(Number(row.price_usd)) || Number(row.price_usd) <= 0).length,
      unknownBrand: sample.filter(row => unknown(row.brand)).length,
      unknownDial: sample.filter(row => unknown(row.dial_color)).length,
      missingYear: sample.filter(row => missing(row.year)).length,
      avgConfidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : 0,
      lastUpdatedAt: sample[0]?.created_at || null,
    });
  } catch (error) {
    console.error('[admin-stats] error:', error.message);
    return res.status(500).json({ error: 'Failed to load live admin statistics' });
  }
};
