-- Forward-only shadow foundation. This migration is intentionally not applied by the
-- census workflow and does not alter any production feed or source selection.

CREATE TABLE IF NOT EXISTS public.curated_luxury_shadow_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETE', 'INCOMPLETE')),
  decision text NOT NULL,
  source_artifact_runs jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_market_observations_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_shadow_runs(run_id) ON DELETE CASCADE,
  raw_occurrence_key text NOT NULL,
  unique_observation_key text NOT NULL,
  offer_family_key text NOT NULL,
  offer_state_key text NOT NULL,
  parent_key text NOT NULL,
  version_key text NOT NULL,
  source_key text NOT NULL,
  exact_child_text_sha256 text NOT NULL,
  parent_raw_text_sha256 text,
  brand text NOT NULL,
  observed_reference text,
  observed_reference_key text,
  intent text CHECK (intent IN ('WTS', 'WTB') OR intent IS NULL),
  condition_as_observed text,
  dial_or_color_as_observed text,
  source_timestamp timestamptz,
  source_price_amount numeric,
  source_currency text,
  normalized_usd_amount numeric,
  usd_normalization_method text,
  price_evidence_classification text,
  dealer_key text,
  country_code text,
  source_image_key text,
  source_status text,
  child_classification text NOT NULL DEFAULT 'UNIQUE_MARKET_OBSERVATION',
  search_text text NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, raw_occurrence_key),
  UNIQUE (run_id, unique_observation_key)
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_offer_states_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_shadow_runs(run_id) ON DELETE CASCADE,
  offer_state_key text NOT NULL,
  offer_family_key text NOT NULL,
  brand text NOT NULL,
  observed_reference_key text,
  source_price_amount numeric,
  source_currency text,
  normalized_usd_amount numeric,
  first_seen timestamptz,
  last_seen timestamptz,
  occurrence_count bigint NOT NULL CHECK (occurrence_count > 0),
  repost_same_offer_count bigint NOT NULL DEFAULT 0 CHECK (repost_same_offer_count >= 0),
  qualified_price_research boolean NOT NULL DEFAULT false,
  latest_raw_occurrence_key text NOT NULL,
  PRIMARY KEY (run_id, offer_state_key)
);

CREATE TABLE IF NOT EXISTS public.curated_luxury_current_listings_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_shadow_runs(run_id) ON DELETE CASCADE,
  current_listing_key text NOT NULL,
  offer_family_key text NOT NULL,
  offer_state_key text NOT NULL,
  latest_raw_occurrence_key text NOT NULL,
  unique_observation_key text NOT NULL,
  parent_key text NOT NULL,
  version_key text NOT NULL,
  source_key text NOT NULL,
  source_page text,
  origin text,
  exact_child_text_sha256 text NOT NULL,
  parent_raw_text_sha256 text,
  source_identity_key text,
  current_status text NOT NULL CHECK (current_status IN
    ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE', 'WITHDRAWN', 'SUPERSEDED', 'SUPPRESSED_EXACT_DUPLICATE')),
  cohort_status text NOT NULL CHECK (cohort_status IN ('CONFIRMED_CURRENT', 'LATEST_OBSERVED')),
  brand text NOT NULL,
  observed_reference text,
  observed_reference_key text,
  intent text CHECK (intent IN ('WTS', 'WTB') OR intent IS NULL),
  condition_as_observed text,
  dial_or_color_as_observed text,
  source_timestamp timestamptz,
  source_price_amount numeric,
  source_currency text,
  normalized_usd_amount numeric,
  price_verified boolean NOT NULL DEFAULT false,
  image_linked boolean NOT NULL DEFAULT false,
  source_image_key text,
  dealer_key text,
  dealer_rating_qualified boolean NOT NULL DEFAULT false,
  country_code text,
  search_text text NOT NULL DEFAULT '',
  PRIMARY KEY (run_id, current_listing_key),
  UNIQUE (run_id, offer_family_key)
);

-- Keep the foundation forward-only and idempotent if the empty pre-lineage shadow
-- schema was installed during review. Existing populated rows fail closed rather
-- than receiving fabricated lineage.
ALTER TABLE public.curated_luxury_current_listings_shadow
  ADD COLUMN IF NOT EXISTS unique_observation_key text,
  ADD COLUMN IF NOT EXISTS parent_key text,
  ADD COLUMN IF NOT EXISTS version_key text,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS source_page text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS exact_child_text_sha256 text,
  ADD COLUMN IF NOT EXISTS parent_raw_text_sha256 text,
  ADD COLUMN IF NOT EXISTS source_identity_key text;

ALTER TABLE public.curated_luxury_current_listings_shadow
  ALTER COLUMN unique_observation_key SET NOT NULL,
  ALTER COLUMN parent_key SET NOT NULL,
  ALTER COLUMN version_key SET NOT NULL,
  ALTER COLUMN source_key SET NOT NULL,
  ALTER COLUMN exact_child_text_sha256 SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.curated_luxury_observed_references_shadow (
  run_id uuid NOT NULL REFERENCES public.curated_luxury_shadow_runs(run_id) ON DELETE CASCADE,
  brand text NOT NULL,
  observed_reference text NOT NULL,
  observed_reference_key text NOT NULL,
  catalog_status text NOT NULL CHECK (catalog_status IN ('CATALOG_CONFIRMED', 'OBSERVED_ONLY')),
  source_occurrence_count bigint NOT NULL DEFAULT 0,
  unique_market_observation_count bigint NOT NULL DEFAULT 0,
  current_listing_count bigint NOT NULL DEFAULT 0,
  qualified_comparable_states bigint NOT NULL DEFAULT 0,
  first_seen timestamptz,
  last_seen timestamptz,
  PRIMARY KEY (run_id, brand, observed_reference_key)
);

CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_filter_idx
  ON public.curated_luxury_current_listings_shadow
  (run_id, current_status, brand, intent, country_code, source_timestamp DESC, current_listing_key);
CREATE INDEX IF NOT EXISTS curated_luxury_current_shadow_reference_idx
  ON public.curated_luxury_current_listings_shadow (run_id, observed_reference_key, source_timestamp DESC);
CREATE INDEX IF NOT EXISTS curated_luxury_offer_states_shadow_pr_idx
  ON public.curated_luxury_offer_states_shadow
  (run_id, brand, observed_reference_key, qualified_price_research, last_seen DESC);

ALTER TABLE public.curated_luxury_shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_market_observations_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_offer_states_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_current_listings_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curated_luxury_observed_references_shadow ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.curated_luxury_current_shadow_page(
  p_run_id uuid,
  p_brands text[] DEFAULT NULL,
  p_intents text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_priced_only boolean DEFAULT false,
  p_images_only boolean DEFAULT false,
  p_search text DEFAULT NULL,
  p_after_timestamp timestamptz DEFAULT NULL,
  p_after_key text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.curated_luxury_current_listings_shadow
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.*
  FROM public.curated_luxury_current_listings_shadow c
  JOIN public.curated_luxury_shadow_runs r ON r.run_id = c.run_id
  WHERE c.run_id = p_run_id
    AND r.status = 'COMPLETE'
    AND c.current_status IN ('CURRENT_ACTIVE', 'CURRENT_LATEST_STATE')
    AND (p_brands IS NULL OR c.brand = ANY(p_brands))
    AND (p_intents IS NULL OR c.intent = ANY(p_intents))
    AND (p_countries IS NULL OR c.country_code = ANY(p_countries))
    AND (NOT p_priced_only OR c.price_verified)
    AND (NOT p_images_only OR c.image_linked)
    AND (NULLIF(regexp_replace(upper(coalesce(p_search, '')), '[^A-Z0-9]', '', 'g'), '') IS NULL
      OR c.observed_reference_key = regexp_replace(upper(p_search), '[^A-Z0-9]', '', 'g')
      OR regexp_replace(upper(c.search_text), '[^A-Z0-9]', '', 'g') LIKE
        '%' || regexp_replace(upper(p_search), '[^A-Z0-9]', '', 'g') || '%')
    AND (p_after_timestamp IS NULL OR (coalesce(c.source_timestamp, '-infinity'::timestamptz), c.current_listing_key)
      < (p_after_timestamp, coalesce(p_after_key, '')))
  ORDER BY coalesce(c.source_timestamp, '-infinity'::timestamptz) DESC, c.current_listing_key DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.curated_luxury_current_shadow_page(
  uuid, text[], text[], text[], boolean, boolean, text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curated_luxury_current_shadow_page(
  uuid, text[], text[], text[], boolean, boolean, text, timestamptz, text, integer) TO service_role;

COMMENT ON FUNCTION public.curated_luxury_current_shadow_page IS
  'Server-side bounded shadow feed only. Does not switch the production Trading Floor source.';
