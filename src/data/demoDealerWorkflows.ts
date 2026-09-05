export interface DemoWorkspacePayload {
  user: { email: string; role: string };
  dealer: {
    display_name: string;
    company_name: string;
    city: string;
    country_code: string;
    profile_summary: string;
    avatar_url: string | null;
    contact_consent: boolean;
    rating: number;
    review_count: number;
    whatsapp_group_count: number;
    metadata: {
      account_type: string;
      website_url: string;
      preferred_language: string;
      timezone: string;
      telegram_username: string;
    };
  };
  profile_stamp: {
    name: string;
    company: string;
    phone: string;
    location: string;
    avatar_url: string | null;
    rating: number;
    review_count: number;
    group_count: number;
  };
  preferences: { display_currency: string; email_notifications: boolean };
  stats: { active_listings: number; wts_posts: number; wtb_posts: number; posting_years: number };
  listings: Array<{ id: string; brand: string | null; reference: string | null; dial_color: string | null; listing_type: string; listing_date: string; price_usd: number | null }>;
  submissions: Array<{ id: string; intent: string; category: string; review_status: string; publication_status: string; bulk_submission_id: string; created_at: string; claimed_fields: Record<string, string> }>;
  tickets: Array<{ id: string; subject: string; status: string; created_at: string }>;
}

export interface DemoPoster {
  dealer_id: string;
  email: string;
  name: string;
  company: string;
  phone: string;
  location: string;
  avatar_url: string | null;
  credential_status: string;
  rating: number;
  review_count: number;
  group_count: number;
}

const sharedAvatar = '/images/watchfacts-hero-watch.png';

export const demoDealerWorkflows: Record<string, DemoWorkspacePayload> = {
  camila: {
    user: { email: 'camila.demo@example.test', role: 'dealer' },
    dealer: { display_name: 'Camila Alvarez', company_name: 'Meridian Timepieces', city: 'Miami', country_code: 'USA', profile_summary: 'Synthetic bilingual dealer profile used to validate credential stamping, reputation, WTS, WTB, and moderated posting states.', avatar_url: sharedAvatar, contact_consent: true, rating: 4.9, review_count: 84, whatsapp_group_count: 12, metadata: { account_type: 'dealer', website_url: 'https://example.test/meridian', preferred_language: 'es', timezone: 'America/New_York', telegram_username: '@meridian_demo' } },
    profile_stamp: { name: 'Camila Alvarez', company: 'Meridian Timepieces', phone: '+1 305 555 0142', location: 'Miami, USA', avatar_url: sharedAvatar, rating: 4.9, review_count: 84, group_count: 12 },
    preferences: { display_currency: 'USD', email_notifications: true }, stats: { active_listings: 8, wts_posts: 41, wtb_posts: 9, posting_years: 4 },
    listings: [
      { id: 'demo-camila-5712', brand: 'Patek Philippe', reference: '5712/1A-001', dial_color: 'Blue', listing_type: 'WTS', listing_date: '2026-08-08', price_usd: 109500 },
      { id: 'demo-camila-116500', brand: 'Rolex', reference: '116500LN', dial_color: 'White', listing_type: 'WTB', listing_date: '2026-08-07', price_usd: null },
    ],
    submissions: [
      { id: 'demo-sub-camila-1', intent: 'WTS', category: 'WATCH', review_status: 'APPROVED', publication_status: 'PUBLISHED', bulk_submission_id: 'demo-batch-camila', created_at: '2026-08-08T15:00:00Z', claimed_fields: { brand: 'Patek Philippe', reference: '5712/1A-001' } },
      { id: 'demo-sub-camila-2', intent: 'WTB', category: 'WATCH', review_status: 'PENDING_REVIEW', publication_status: 'QUEUED', bulk_submission_id: 'demo-batch-camila', created_at: '2026-08-08T15:00:00Z', claimed_fields: { brand: 'Rolex', reference: '116500LN' } },
    ], tickets: [],
  },
  marcus: {
    user: { email: 'marcus.demo@example.test', role: 'dealer' },
    dealer: { display_name: 'Marcus Chen', company_name: 'Pacific Horology', city: 'Hong Kong', country_code: 'HKG', profile_summary: 'Synthetic broker profile demonstrating HKD preferences, high-volume watch activity, image review, and a non-watch luxury submission.', avatar_url: sharedAvatar, contact_consent: true, rating: 4.8, review_count: 132, whatsapp_group_count: 21, metadata: { account_type: 'broker', website_url: 'https://example.test/pacific', preferred_language: 'zh', timezone: 'Asia/Hong_Kong', telegram_username: '@pacific_demo' } },
    profile_stamp: { name: 'Marcus Chen', company: 'Pacific Horology', phone: '+852 5555 0188', location: 'Hong Kong, HKG', avatar_url: sharedAvatar, rating: 4.8, review_count: 132, group_count: 21 },
    preferences: { display_currency: 'HKD', email_notifications: true }, stats: { active_listings: 17, wts_posts: 118, wtb_posts: 26, posting_years: 7 },
    listings: [
      { id: 'demo-marcus-116500', brand: 'Rolex', reference: '116500LN', dial_color: 'Black', listing_type: 'WTS', listing_date: '2026-08-08', price_usd: 26750 },
    ],
    submissions: [
      { id: 'demo-sub-marcus-1', intent: 'WTS', category: 'WATCH', review_status: 'APPROVED', publication_status: 'PUBLISHED', bulk_submission_id: 'demo-batch-marcus-a', created_at: '2026-08-08T10:00:00Z', claimed_fields: { brand: 'Rolex', reference: '116500LN' } },
      { id: 'demo-sub-marcus-2', intent: 'WTS', category: 'HANDBAG', review_status: 'PENDING_REVIEW', publication_status: 'QUEUED', bulk_submission_id: 'demo-batch-marcus-b', created_at: '2026-08-09T08:00:00Z', claimed_fields: { title: 'Hermes Birkin 30 Togo' } },
    ], tickets: [{ id: 'demo-ticket-marcus', subject: 'Update verified company name', status: 'OPEN', created_at: '2026-08-06T08:00:00Z' }],
  },
  ana: {
    user: { email: 'ana.demo@example.test', role: 'dealer' },
    dealer: { display_name: 'Ana Ferreira', company_name: 'Lusso Vault', city: 'São Paulo', country_code: 'BRA', profile_summary: 'Synthetic Portuguese-language company profile demonstrating jewelry publication, no-price demand, groups, and a rejected evidence review.', avatar_url: sharedAvatar, contact_consent: true, rating: 4.7, review_count: 47, whatsapp_group_count: 8, metadata: { account_type: 'company', website_url: 'https://example.test/lusso', preferred_language: 'pt', timezone: 'America/Sao_Paulo', telegram_username: '@lusso_demo' } },
    profile_stamp: { name: 'Ana Ferreira', company: 'Lusso Vault', phone: '+55 11 5555 0131', location: 'São Paulo, BRA', avatar_url: sharedAvatar, rating: 4.7, review_count: 47, group_count: 8 },
    preferences: { display_currency: 'USD', email_notifications: false }, stats: { active_listings: 5, wts_posts: 23, wtb_posts: 14, posting_years: 3 },
    listings: [
      { id: 'demo-ana-jewel', brand: 'Cartier', reference: null, dial_color: null, listing_type: 'WTS', listing_date: '2026-08-06', price_usd: 18500 },
      { id: 'demo-ana-5712', brand: 'Patek Philippe', reference: '5712R-001', dial_color: 'Brown', listing_type: 'WTB', listing_date: '2026-08-05', price_usd: null },
    ],
    submissions: [
      { id: 'demo-sub-ana-1', intent: 'WTS', category: 'JEWELRY', review_status: 'APPROVED', publication_status: 'PUBLISHED', bulk_submission_id: 'demo-batch-ana-a', created_at: '2026-08-06T12:00:00Z', claimed_fields: { title: 'Cartier diamond bracelet' } },
      { id: 'demo-sub-ana-2', intent: 'WTB', category: 'WATCH', review_status: 'PENDING_REVIEW', publication_status: 'QUEUED', bulk_submission_id: 'demo-batch-ana-b', created_at: '2026-08-08T12:00:00Z', claimed_fields: { brand: 'Patek Philippe', reference: '5712R-001' } },
      { id: 'demo-sub-ana-3', intent: 'WTS', category: 'ACCESSORY', review_status: 'REJECTED', publication_status: 'REJECTED', bulk_submission_id: 'demo-batch-ana-c', created_at: '2026-08-04T12:00:00Z', claimed_fields: { title: 'Luxury accessory - image mismatch' } },
    ], tickets: [],
  },
};

export const demoDealerLabels = { camila: 'Camila · Miami', marcus: 'Marcus · Hong Kong', ana: 'Ana · São Paulo' } as const;

export function getDemoDealerWorkflow(id: string | null) {
  return id && demoDealerWorkflows[id] ? structuredClone(demoDealerWorkflows[id]) : null;
}

export function getDemoPoster(id: string | null): DemoPoster | null {
  const workflow = getDemoDealerWorkflow(id);
  if (!workflow) return null;
  return {
    dealer_id: `demo-${id}`,
    email: workflow.user.email,
    name: workflow.profile_stamp.name,
    company: workflow.profile_stamp.company,
    phone: workflow.profile_stamp.phone,
    location: workflow.profile_stamp.location,
    avatar_url: workflow.profile_stamp.avatar_url,
    credential_status: 'SYNTHETIC DEMO',
    rating: workflow.profile_stamp.rating,
    review_count: workflow.profile_stamp.review_count,
    group_count: workflow.profile_stamp.group_count,
  };
}
