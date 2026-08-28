-- Immutable, raw-source-only storage for IWC, Hublot, Seiko, Bell & Ross, and Tissot.
-- This migration uses raw source evidence only, does not mutate raw/source rows, and exposes no customer endpoint.

CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_only_shadow_runs (
  run_id uuid PRIMARY KEY,
  contract text NOT NULL CHECK (contract='curated-luxury-five-brand-raw-only-batch-v1'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256~'^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT','LOADED','COMPLETE','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_only_current_listings_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_raw_only_shadow_runs(run_id),
  current_listing_key text NOT NULL,
  offer_family_key text NOT NULL,
  offer_state_key text NOT NULL,
  parent_raw_message_id uuid NOT NULL REFERENCES public.raw_messages(id),
  raw_version_id uuid NOT NULL REFERENCES public.raw_message_versions(id),
  source_record_id text,
  raw_occurrence_key text NOT NULL,
  exact_child_text_sha256 text NOT NULL CHECK (exact_child_text_sha256~'^[0-9a-f]{64}$'),
  brand text NOT NULL CHECK (brand IN ('IWC','Hublot','Seiko','Bell & Ross','Tissot')),
  model_as_posted text,
  observed_reference text,
  observed_reference_key text,
  intent text NOT NULL CHECK (intent IN ('WTS','WTB')),
  current_status text NOT NULL CHECK (current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')),
  cohort_status text NOT NULL CHECK (cohort_status IN ('CONFIRMED_CURRENT','LATEST_OBSERVED')),
  source_timestamp timestamptz NOT NULL,
  source_price_amount numeric CHECK (source_price_amount>0),
  source_currency text,
  price_evidence_status text NOT NULL,
  normalized_usd_amount numeric CHECK (normalized_usd_amount>0),
  normalized_usd_evidence text CHECK (normalized_usd_evidence IN
    ('SOURCE_EXPLICIT_USD','SOURCE_EXPLICIT_USDT','DATED_VERIFIED_FX')),
  country_code text,
  country_name text,
  dealer_id uuid REFERENCES public.dealers(id),
  source_poster_evidence_present boolean NOT NULL DEFAULT false,
  raw_message_sha256 text NOT NULL CHECK (raw_message_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key),
  UNIQUE (run_id,offer_family_key),
  UNIQUE (run_id,raw_occurrence_key),
  CHECK (current_listing_key=offer_family_key),
  CHECK ((current_status='CURRENT_ACTIVE' AND cohort_status='CONFIRMED_CURRENT')
    OR (current_status='CURRENT_LATEST_STATE' AND cohort_status='LATEST_OBSERVED')),
  CHECK ((normalized_usd_amount IS NULL AND normalized_usd_evidence IS NULL)
    OR (normalized_usd_amount IS NOT NULL AND normalized_usd_evidence IS NOT NULL)),
  CHECK (normalized_usd_evidence='DATED_VERIFIED_FX' OR normalized_usd_evidence IS NULL
    OR upper(source_currency) IN ('USD','USDT'))
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_only_child_image_evidence_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  raw_occurrence_key text NOT NULL,
  source_image_key text NOT NULL,
  image_url text NOT NULL CHECK (image_url~'^https?://'),
  image_evidence_type text NOT NULL CHECK (image_evidence_type='SELLER_LISTING_IMAGE'),
  exact_child_text_sha256 text NOT NULL CHECK (exact_child_text_sha256~'^[0-9a-f]{64}$'),
  evidence_checksum text NOT NULL CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,source_image_key),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_raw_only_current_listings_shadow(run_id,current_listing_key)
);

-- One immutable record for each price made eligible for customer USD display.
-- Foreign source price is never overwritten; the dated FX provenance is stored
-- alongside it and is required for every foreign USD conversion.
CREATE TABLE IF NOT EXISTS public.curated_luxury_raw_only_price_evidence_shadow (
  run_id uuid NOT NULL,
  current_listing_key text NOT NULL,
  evidence_version integer NOT NULL DEFAULT 1 CHECK (evidence_version>0),
  source_price_amount numeric NOT NULL CHECK (source_price_amount>0),
  source_currency text NOT NULL,
  normalized_usd_amount numeric NOT NULL CHECK (normalized_usd_amount>0),
  price_evidence_classification text NOT NULL CHECK (price_evidence_classification IN
    ('SOURCE_EXPLICIT_USD_MATCH','SOURCE_EXPLICIT_USD_USDT','DATED_VERIFIED_FX')),
  fx_provider text,
  fx_applicable_date date,
  fx_effective_date date,
  fx_lookback_days integer CHECK (fx_lookback_days BETWEEN 0 AND 7),
  fx_usd_per_source_unit numeric CHECK (fx_usd_per_source_unit>0),
  fx_source_url text CHECK (fx_source_url IS NULL OR fx_source_url~'^https://data-api[.]ecb[.]europa[.]eu/'),
  evidence_checksum text NOT NULL CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,current_listing_key,evidence_version),
  FOREIGN KEY (run_id,current_listing_key)
    REFERENCES public.curated_luxury_raw_only_current_listings_shadow(run_id,current_listing_key),
  CHECK (
    (price_evidence_classification IN ('SOURCE_EXPLICIT_USD_MATCH','SOURCE_EXPLICIT_USD_USDT')
      AND fx_provider IS NULL AND fx_applicable_date IS NULL AND fx_effective_date IS NULL
      AND fx_lookback_days IS NULL AND fx_usd_per_source_unit IS NULL AND fx_source_url IS NULL
      AND upper(source_currency) IN ('USD','USDT'))
    OR (price_evidence_classification='DATED_VERIFIED_FX' AND fx_provider='ECB'
      AND fx_applicable_date IS NOT NULL AND fx_effective_date IS NOT NULL
      AND fx_lookback_days IS NOT NULL AND fx_usd_per_source_unit IS NOT NULL AND fx_source_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS curated_luxury_raw_only_current_brand_page_idx
  ON public.curated_luxury_raw_only_current_listings_shadow
  (run_id,brand,source_timestamp DESC,current_listing_key DESC);
CREATE INDEX IF NOT EXISTS curated_luxury_raw_only_current_reference_idx
  ON public.curated_luxury_raw_only_current_listings_shadow
  (run_id,brand,observed_reference_key,source_timestamp DESC)
  WHERE observed_reference_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS curated_luxury_raw_only_current_pr_idx
  ON public.curated_luxury_raw_only_current_listings_shadow
  (run_id,brand,observed_reference_key,normalized_usd_amount)
  WHERE intent='WTS' AND normalized_usd_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS curated_luxury_raw_only_image_listing_idx
  ON public.curated_luxury_raw_only_child_image_evidence_shadow(run_id,current_listing_key);
CREATE INDEX IF NOT EXISTS curated_luxury_raw_only_price_listing_idx
  ON public.curated_luxury_raw_only_price_evidence_shadow(run_id,current_listing_key,evidence_version DESC);

CREATE OR REPLACE FUNCTION public.curated_luxury_reject_raw_only_shadow_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Curated Luxury raw-only shadow evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS curated_luxury_raw_only_current_append_only
  ON public.curated_luxury_raw_only_current_listings_shadow;
CREATE TRIGGER curated_luxury_raw_only_current_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_raw_only_current_listings_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_raw_only_shadow_mutation_v1();
DROP TRIGGER IF EXISTS curated_luxury_raw_only_image_append_only
  ON public.curated_luxury_raw_only_child_image_evidence_shadow;
CREATE TRIGGER curated_luxury_raw_only_image_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_raw_only_child_image_evidence_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_raw_only_shadow_mutation_v1();
DROP TRIGGER IF EXISTS curated_luxury_raw_only_price_append_only
  ON public.curated_luxury_raw_only_price_evidence_shadow;
CREATE TRIGGER curated_luxury_raw_only_price_append_only
  BEFORE UPDATE OR DELETE ON public.curated_luxury_raw_only_price_evidence_shadow
  FOR EACH ROW EXECUTE FUNCTION public.curated_luxury_reject_raw_only_shadow_mutation_v1();

ALTER TABLE public.curated_luxury_raw_only_shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_raw_only_current_listings_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_raw_only_child_image_evidence_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_raw_only_price_evidence_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curated_luxury_raw_only_shadow_runs,
  public.curated_luxury_raw_only_current_listings_shadow,
  public.curated_luxury_raw_only_child_image_evidence_shadow,
  public.curated_luxury_raw_only_price_evidence_shadow
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.curated_luxury_raw_only_shadow_runs TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_raw_only_current_listings_shadow TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_raw_only_child_image_evidence_shadow TO service_role;
GRANT SELECT,INSERT ON public.curated_luxury_raw_only_price_evidence_shadow TO service_role;

NOTIFY pgrst,'reload schema';
