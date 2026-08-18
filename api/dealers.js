'use strict';

const { getClient } = require('./_lib/supabase');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const client = getClient();

  const page = boundedInteger(req.query?.page, 1, 1, 100000);
  const pageSize = boundedInteger(req.query?.pageSize, 24, 1, 100);
  const search = String(req.query?.q || '').trim().slice(0, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at', { count: 'exact' })
      .eq('status', 'VERIFIED')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('display_name', { ascending: true })
      .range(from, to);

    if (search) {
      const escaped = search.replace(/[%_,()]/g, ' ').trim();
      if (escaped) query = query.or(`display_name.ilike.%${escaped}%,company_name.ilike.%${escaped}%,city.ilike.%${escaped}%`);
    }

    const { data: dealers, count, error } = await query;
    if (error) throw error;
    const ids = (dealers || []).map(item => item.id);
    const { data: stats, error: statsError } = ids.length
      ? await client.from('dealer_profile_stats').select('*').in('dealer_id', ids)
      : { data: [], error: null };
    if (statsError) throw statsError;
    const statsById = new Map((stats || []).map(item => [item.dealer_id, item]));

    return res.status(200).json({
      success: true,
      page,
      pageSize,
      total: count || 0,
      dealers: (dealers || []).map(dealer => ({ ...dealer, stats: statsById.get(dealer.id) || null })),
    });
  } catch (error) {
    console.error('[dealers]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema ? 'Dealer profiles are awaiting the production migration.' : 'Unable to load dealer profiles.',
    });
  }
};
