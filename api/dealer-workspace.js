'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function clean(value, max = 200) {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function linkedDealer(client, userId) {
  const { data, error } = await client.from('dealers')
    .select('id,slug,display_name,company_name,country_code,city,profile_summary,avatar_url,status,contact_consent,rating,review_count,whatsapp_group_count,metadata')
    .eq('auth_user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const authorization = await authorizeDealer(req, res);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });

  try {
    const dealer = await linkedDealer(authorization.client, authorization.user.id);
    if (req.method === 'GET') {
      const [preferencesResult, ticketsResult, submissionsResult, listingsResult, statsResult, phoneResult] = await Promise.all([
        authorization.client.from('dealer_account_preferences').select('*').eq('auth_user_id', authorization.user.id).maybeSingle(),
        authorization.client.from('dealer_support_tickets').select('id,subject,status,created_at').eq('auth_user_id', authorization.user.id).order('created_at', { ascending: false }).limit(20),
        authorization.client.from('dealer_listing_submissions').select('id,intent,category,claimed_fields,review_status,publication_status,bulk_submission_id,created_at').eq('auth_user_id', authorization.user.id).order('created_at', { ascending: false }).limit(100),
        dealer ? authorization.client.from('watch_records').select('id,brand,reference,dial_color,condition,price_usd,currency,listing_type,listing_date,listing_status').eq('dealer_id', dealer.id).order('listing_date', { ascending: false, nullsFirst: false }).limit(100) : Promise.resolve({ data: [], error: null }),
        dealer ? authorization.client.from('dealer_profile_stats').select('*').eq('dealer_id', dealer.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        dealer ? authorization.client.from('dealer_source_identities').select('source_identity,identity_type,verification_status').eq('dealer_id', dealer.id).eq('verification_status', 'VERIFIED').in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']).limit(1) : Promise.resolve({ data: [], error: null }),
      ]);
      const error = [preferencesResult, ticketsResult, submissionsResult, listingsResult, statsResult, phoneResult].find(result => result.error)?.error;
      if (error) throw error;
      const phoneIdentity = phoneResult.data?.[0] || null;
      return res.status(200).json({
        success: true,
        user: { email: authorization.user.email, role: authorization.role },
        dealer,
        profile_stamp: dealer ? {
          name: dealer.display_name || dealer.company_name || null,
          company: dealer.company_name || null,
          phone: phoneIdentity?.source_identity || null,
          location: [dealer.city, dealer.country_code].filter(Boolean).join(', ') || null,
          avatar_url: dealer.avatar_url || null,
          rating: dealer.rating,
          review_count: dealer.review_count,
          group_count: dealer.whatsapp_group_count,
        } : null,
        preferences: preferencesResult.data || { display_currency: 'USD', email_notifications: true },
        tickets: ticketsResult.data || [], submissions: submissionsResult.data || [],
        listings: listingsResult.data || [], stats: statsResult.data || null,
      });
    }

    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    const section = clean(req.body?.section, 30);
    if (section === 'preferences') {
      const currency = clean(req.body?.display_currency, 8)?.toUpperCase();
      if (!['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD'].includes(currency)) return res.status(400).json({ error: 'Unsupported display currency.' });
      const { error } = await authorization.client.from('dealer_account_preferences').upsert({
        auth_user_id: authorization.user.id, display_currency: currency,
        email_notifications: req.body?.email_notifications !== false, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    if (section === 'profile') {
      if (!dealer) return res.status(409).json({ error: 'This account is awaiting dealer-profile linkage.' });
      const updates = {
        display_name: clean(req.body?.display_name), company_name: clean(req.body?.company_name),
        city: clean(req.body?.city, 120), country_code: clean(req.body?.country_code, 3)?.toUpperCase(),
        profile_summary: clean(req.body?.profile_summary, 1000),
        metadata: {
          ...(dealer.metadata || {}),
          account_type: ['individual', 'dealer', 'company', 'broker'].includes(clean(req.body?.account_type, 20)) ? clean(req.body?.account_type, 20) : 'dealer',
          website_url: clean(req.body?.website_url, 500),
          preferred_language: clean(req.body?.preferred_language, 10),
          timezone: clean(req.body?.timezone, 80),
          telegram_username: clean(req.body?.telegram_username, 120),
        },
        contact_consent: req.body?.contact_consent === true, updated_at: new Date().toISOString(),
      };
      const { error } = await authorization.client.from('dealers').update(updates).eq('id', dealer.id).eq('auth_user_id', authorization.user.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    if (section === 'ticket') {
      const subject = clean(req.body?.subject, 160);
      const message = clean(req.body?.message, 5000);
      if (!subject || subject.length < 3 || !message || message.length < 10) return res.status(400).json({ error: 'Enter a subject and at least 10 characters of detail.' });
      const { data, error } = await authorization.client.from('dealer_support_tickets').insert({
        auth_user_id: authorization.user.id, dealer_id: dealer?.id || null, subject, message,
      }).select('id,subject,status,created_at').single();
      if (error) throw error;
      return res.status(201).json({ success: true, ticket: data });
    }
    return res.status(400).json({ error: 'Unknown workspace section.' });
  } catch (error) {
    console.error('[dealer-workspace]', error.message);
    return res.status(500).json({ error: 'Unable to update dealer workspace.' });
  }
};
