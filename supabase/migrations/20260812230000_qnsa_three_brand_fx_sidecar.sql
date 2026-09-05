-- Production-safe FX overlay for the completed QNSA normalization run.
-- No statement in this migration updates staging.listings or immutable raw data.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS staging.three_brand_fx_sidecar_runs (
  run_key text PRIMARY KEY,
  normalization_run_key text NOT NULL,
  policy_version text NOT NULL,
  fx_snapshot jsonb NOT NULL,
  census_rows bigint NOT NULL DEFAULT 0 CHECK (census_rows >= 0),
  discovery_cursor_listing_id uuid,
  cursor_listing_id uuid,
  scanned_rows bigint NOT NULL DEFAULT 0,
  corrected_rows bigint NOT NULL DEFAULT 0,
  skipped_rows bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DISCOVERING' CHECK (status IN ('DISCOVERING','READY','RUNNING','COMPLETE')),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (scanned_rows = corrected_rows + skipped_rows),
  CHECK (scanned_rows <= census_rows)
);

CREATE TABLE IF NOT EXISTS staging.three_brand_fx_sidecar (
  run_key text NOT NULL REFERENCES staging.three_brand_fx_sidecar_runs(run_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES staging.listings(id) ON DELETE RESTRICT,
  normalization_run_key text NOT NULL,
  source_record_id text NOT NULL,
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  brand_normalized text NOT NULL CHECK (brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')),
  reference_normalized text NOT NULL,
  amount_original numeric NOT NULL CHECK (amount_original > 0),
  currency_original text NOT NULL,
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  conversion_rate numeric NOT NULL CHECK (conversion_rate > 0),
  conversion_source text NOT NULL,
  conversion_timestamp timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  batch_token text NOT NULL CHECK (batch_token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, listing_id),
  UNIQUE (run_key, source_record_id, source_hash)
);

CREATE TABLE IF NOT EXISTS staging.three_brand_fx_sidecar_candidates (
  run_key text NOT NULL REFERENCES staging.three_brand_fx_sidecar_runs(run_key) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES staging.listings(id) ON DELETE RESTRICT,
  PRIMARY KEY(run_key,listing_id)
);

CREATE TABLE IF NOT EXISTS public.three_brand_fx_release_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_run_key text REFERENCES staging.three_brand_fx_sidecar_runs(run_key) ON DELETE RESTRICT,
  activated_at timestamptz,
  activated_by text,
  CHECK ((active_run_key IS NULL) = (activated_at IS NULL))
);
INSERT INTO public.three_brand_fx_release_control(singleton) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE staging.three_brand_fx_sidecar_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.three_brand_fx_sidecar ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.three_brand_fx_sidecar_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.three_brand_fx_release_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staging.three_brand_fx_sidecar_runs, staging.three_brand_fx_sidecar,
  staging.three_brand_fx_sidecar_candidates,
  public.three_brand_fx_release_control FROM PUBLIC, anon, authenticated;
GRANT ALL ON staging.three_brand_fx_sidecar_runs, staging.three_brand_fx_sidecar,
  staging.three_brand_fx_sidecar_candidates,
  public.three_brand_fx_release_control TO service_role;

CREATE INDEX IF NOT EXISTS idx_three_brand_fx_sidecar_listing
  ON staging.three_brand_fx_sidecar(listing_id, run_key);

CREATE OR REPLACE FUNCTION public.start_three_brand_fx_sidecar(
  p_run_key text, p_normalization_run_key text, p_policy_version text, p_fx_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE;
BEGIN
  IF p_run_key !~ '^[A-Za-z0-9._:-]{1,100}$' OR p_normalization_run_key !~ '^[A-Za-z0-9._:-]{1,100}$'
    OR p_fx_snapshot->>'contract' IS DISTINCT FROM 'wf-dated-fx-snapshot-v1'
    OR p_fx_snapshot->>'base' IS DISTINCT FROM 'USD' OR jsonb_typeof(p_fx_snapshot->'usd_per_unit') <> 'object'
    OR COALESCE(p_fx_snapshot->>'observed_at','')='' OR COALESCE(p_fx_snapshot->>'source','')='' THEN
    RAISE EXCEPTION 'invalid immutable sidecar configuration';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['USD','EUR','HKD','GBP','CHF','CNY','JPY','SGD','KRW','THB','CAD','AUD','NZD','MYR','IDR','INR','PHP','BRL','MXN','ZAR','SEK','NOK','DKK']) code
    WHERE COALESCE((p_fx_snapshot->'usd_per_unit'->>code)::numeric,0)<=0)
    OR (p_fx_snapshot->'usd_per_unit'->>'USD')::numeric IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'FX snapshot is incomplete';
  END IF;
  PERFORM 1 FROM staging.mariadb_normalization_import_checkpoints WHERE run_key=p_normalization_run_key
    AND status='NORMALIZATION_STAGED' AND error_rows=0 AND input_rows=staged_rows+existing_rows+deferred_rows;
  IF NOT FOUND THEN RAISE EXCEPTION 'normalization run is not reconciled'; END IF;
  INSERT INTO staging.three_brand_fx_sidecar_runs(run_key,normalization_run_key,policy_version,fx_snapshot,census_rows,status,completed_at)
    VALUES(p_run_key,p_normalization_run_key,p_policy_version,p_fx_snapshot,0,'DISCOVERING',NULL)
    ON CONFLICT(run_key) DO NOTHING;
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key;
  IF v_run.normalization_run_key<>p_normalization_run_key OR v_run.policy_version<>p_policy_version
    OR v_run.fx_snapshot IS DISTINCT FROM p_fx_snapshot THEN RAISE EXCEPTION 'immutable run mismatch'; END IF;
  RETURN to_jsonb(v_run);
END $$;

-- Builds a fixed run ledger in bounded index-backed pages; no full COUNT/JOIN
-- is issued through the management gateway.
CREATE OR REPLACE FUNCTION public.discover_three_brand_fx_sidecar_candidates(p_run_key text,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE; v_found integer; v_next uuid; v_total bigint;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'discovery limit must be 1..500'; END IF;
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status<>'DISCOVERING' THEN RAISE EXCEPTION 'run is not discovering'; END IF;
  WITH page AS MATERIALIZED (
    SELECT l.id FROM staging.listings l WHERE l.normalization_run_key=v_run.normalization_run_key
      AND l.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
      AND (v_run.discovery_cursor_listing_id IS NULL OR l.id>v_run.discovery_cursor_listing_id)
      AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
      AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND NULLIF(btrim(l.reference_normalized),'') IS NOT NULL
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (COALESCE(l.price_usd,0)<=0 OR (upper(COALESCE(l.currency_normalized,'')) NOT IN ('USD','USDT')
        AND (COALESCE(l.conversion_rate,0)<=0 OR l.conversion_timestamp IS NULL OR NULLIF(btrim(l.conversion_source),'') IS NULL)))
      ORDER BY l.id LIMIT p_limit), ins AS (
    INSERT INTO staging.three_brand_fx_sidecar_candidates(run_key,listing_id)
      SELECT p_run_key,id FROM page ON CONFLICT DO NOTHING RETURNING listing_id)
  SELECT count(*),max(listing_id) INTO v_found,v_next FROM ins;
  IF v_found=0 THEN
    SELECT count(*) INTO v_total FROM staging.three_brand_fx_sidecar_candidates WHERE run_key=p_run_key;
    UPDATE staging.three_brand_fx_sidecar_runs SET census_rows=v_total,status=CASE WHEN v_total=0 THEN 'COMPLETE' ELSE 'READY' END,
      completed_at=CASE WHEN v_total=0 THEN now() END,updated_at=now() WHERE run_key=p_run_key RETURNING * INTO v_run;
  ELSE
    UPDATE staging.three_brand_fx_sidecar_runs SET discovery_cursor_listing_id=v_next,updated_at=now()
      WHERE run_key=p_run_key RETURNING * INTO v_run;
  END IF;
  RETURN to_jsonb(v_run)||jsonb_build_object('discovered_this_page',v_found);
END $$;

CREATE OR REPLACE FUNCTION public.three_brand_fx_sidecar_page(p_run_key text,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE; v_records jsonb;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'page limit must be 1..500'; END IF;
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'sidecar run missing'; END IF;
  IF v_run.status NOT IN ('READY','RUNNING') THEN RAISE EXCEPTION 'sidecar run is not ready for processing'; END IF;
  SELECT COALESCE(jsonb_agg(x.payload ORDER BY x.listing_id),'[]'::jsonb) INTO v_records FROM (
    SELECT l.id listing_id,jsonb_build_object('listing_id',l.id,'source_record_id',l.source_record_id,
      'source_hash',l.source_hash,'canonical_brand',l.brand_normalized,'normalized_reference',l.reference_normalized,
      'raw_payload',rv.raw_payload) payload
    FROM staging.three_brand_fx_sidecar_candidates candidate
    JOIN staging.listings l ON l.id=candidate.listing_id
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id
      AND rv.source_record_id=l.source_record_id AND rv.source_hash=l.source_hash
    WHERE candidate.run_key=p_run_key AND l.normalization_run_key=v_run.normalization_run_key
      AND l.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
      AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
      AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND NULLIF(btrim(l.reference_normalized),'') IS NOT NULL AND (v_run.cursor_listing_id IS NULL OR l.id>v_run.cursor_listing_id)
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND (COALESCE(l.price_usd,0)<=0 OR (upper(COALESCE(l.currency_normalized,'')) NOT IN ('USD','USDT')
        AND (COALESCE(l.conversion_rate,0)<=0 OR l.conversion_timestamp IS NULL OR NULLIF(btrim(l.conversion_source),'') IS NULL)))
    ORDER BY l.id LIMIT p_limit) x;
  RETURN to_jsonb(v_run)||jsonb_build_object('previous_cursor',v_run.cursor_listing_id,'records',v_records);
END $$;

CREATE OR REPLACE FUNCTION public.apply_three_brand_fx_sidecar_batch(p_run_key text,p_batch_token text,p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE; v_written bigint;
BEGIN
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status='COMPLETE' OR p_batch_token !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_records)<>'array'
    OR jsonb_array_length(p_records)>500 THEN RAISE EXCEPTION 'invalid sidecar batch'; END IF;
  WITH input AS (SELECT * FROM jsonb_to_recordset(p_records) AS x(listing_id uuid,normalization_run_key text,
    source_record_id text,source_hash text,brand_normalized text,reference_normalized text,amount_original numeric,
    currency_original text,amount_usd numeric,conversion_rate numeric,conversion_source text,conversion_timestamp timestamptz,evidence jsonb,batch_token text)),
  valid AS (SELECT i.* FROM input i JOIN staging.listings l ON l.id=i.listing_id
    AND l.normalization_run_key=i.normalization_run_key AND l.source_record_id=i.source_record_id
    AND l.source_hash=i.source_hash AND l.brand_normalized=i.brand_normalized AND l.reference_normalized=i.reference_normalized
    JOIN public.raw_message_versions rv ON rv.id=l.raw_message_version_id AND rv.source_record_id=i.source_record_id AND rv.source_hash=i.source_hash
    WHERE i.normalization_run_key=v_run.normalization_run_key AND i.batch_token=p_batch_token
      AND i.conversion_source=v_run.fx_snapshot->>'source'
      AND i.conversion_timestamp=(v_run.fx_snapshot->>'observed_at')::timestamptz
      AND abs(i.conversion_rate-(CASE WHEN i.currency_original='USDT' THEN 1
        ELSE (v_run.fx_snapshot->'usd_per_unit'->>i.currency_original)::numeric END))<0.000000000001),
  inserted AS (INSERT INTO staging.three_brand_fx_sidecar(run_key,listing_id,normalization_run_key,source_record_id,
    source_hash,brand_normalized,reference_normalized,amount_original,currency_original,amount_usd,conversion_rate,
    conversion_source,conversion_timestamp,evidence,batch_token)
    SELECT p_run_key,listing_id,normalization_run_key,source_record_id,source_hash,brand_normalized,reference_normalized,
      amount_original,currency_original,amount_usd,conversion_rate,conversion_source,conversion_timestamp,evidence,batch_token FROM valid
    ON CONFLICT(run_key,listing_id) DO UPDATE SET batch_token=staging.three_brand_fx_sidecar.batch_token
    WHERE staging.three_brand_fx_sidecar.source_hash=excluded.source_hash
      AND staging.three_brand_fx_sidecar.amount_usd=excluded.amount_usd RETURNING 1)
  SELECT count(*) INTO v_written FROM inserted;
  RETURN jsonb_build_object('written_rows',v_written,'staging_row_delta',0,'raw_version_row_delta',0);
END $$;

CREATE OR REPLACE FUNCTION public.advance_three_brand_fx_sidecar(p_run_key text,p_previous uuid,p_next uuid,
  p_scanned bigint,p_corrected bigint,p_skipped bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE; v_count bigint;
BEGIN
  IF p_scanned<>p_corrected+p_skipped OR p_scanned NOT BETWEEN 1 AND 500 OR p_next IS NULL THEN RAISE EXCEPTION 'bad checkpoint'; END IF;
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key FOR UPDATE;
  IF v_run.cursor_listing_id IS DISTINCT FROM p_previous OR v_run.scanned_rows+p_scanned>v_run.census_rows THEN RAISE EXCEPTION 'cursor mismatch'; END IF;
  SELECT count(*) INTO v_count FROM staging.three_brand_fx_sidecar WHERE run_key=p_run_key;
  IF v_count<>v_run.corrected_rows+p_corrected THEN RAISE EXCEPTION 'sidecar count mismatch'; END IF;
  UPDATE staging.three_brand_fx_sidecar_runs SET cursor_listing_id=p_next,scanned_rows=scanned_rows+p_scanned,
    corrected_rows=corrected_rows+p_corrected,skipped_rows=skipped_rows+p_skipped,status=CASE WHEN scanned_rows+p_scanned=census_rows THEN 'COMPLETE' ELSE 'RUNNING' END,
    completed_at=CASE WHEN scanned_rows+p_scanned=census_rows THEN now() END,updated_at=now() WHERE run_key=p_run_key RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END $$;

-- Only a COMPLETE, fully reconciled run can become visible. The pointer update is
-- one transaction and therefore atomically switches both customer read models.
CREATE OR REPLACE FUNCTION public.activate_three_brand_fx_sidecar(p_run_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,staging,pg_catalog AS $$
DECLARE v_run staging.three_brand_fx_sidecar_runs%ROWTYPE; v_count bigint;
BEGIN
  SELECT * INTO v_run FROM staging.three_brand_fx_sidecar_runs WHERE run_key=p_run_key FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'COMPLETE' OR v_run.scanned_rows <> v_run.census_rows
    OR v_run.scanned_rows <> v_run.corrected_rows + v_run.skipped_rows THEN
    RAISE EXCEPTION 'sidecar run is not complete and reconciled';
  END IF;
  SELECT count(*) INTO v_count FROM staging.three_brand_fx_sidecar WHERE run_key=p_run_key;
  IF v_count <> v_run.corrected_rows THEN RAISE EXCEPTION 'sidecar row count does not reconcile'; END IF;
  INSERT INTO public.three_brand_fx_release_control(singleton,active_run_key,activated_at,activated_by)
  VALUES(true,p_run_key,now(),current_user)
  ON CONFLICT(singleton) DO UPDATE SET active_run_key=excluded.active_run_key,
    activated_at=excluded.activated_at, activated_by=excluded.activated_by;
END $$;

CREATE OR REPLACE VIEW public.qnsa_three_brand_effective_prices
WITH (security_invoker=true) AS
SELECT l.id AS listing_id,
  COALESCE(s.amount_original,l.price_normalized) AS effective_price_original,
  COALESCE(s.currency_original,l.currency_normalized) AS effective_currency,
  COALESCE(s.amount_usd,l.price_usd) AS effective_price_usd,
  COALESCE(s.conversion_rate,l.conversion_rate) AS effective_conversion_rate,
  COALESCE(s.conversion_source,l.conversion_source) AS effective_conversion_source,
  COALESCE(s.conversion_timestamp,l.conversion_timestamp) AS effective_conversion_timestamp,
  (s.listing_id IS NOT NULL) AS sidecar_applied,
  s.run_key AS sidecar_run_key,
  s.evidence AS sidecar_evidence,
  s.amount_usd AS corrected_price_usd,
  s.amount_original AS corrected_source_amount,
  s.currency_original AS corrected_source_currency,
  s.conversion_rate AS corrected_fx_rate,
  s.conversion_source AS corrected_fx_source,
  s.conversion_timestamp AS corrected_fx_date,
  CASE WHEN s.listing_id IS NOT NULL THEN 'QUALIFIED' END AS price_correction_status,
  s.listing_id AS price_correction_id,
  s.run_key AS price_correction_key
FROM staging.listings l
LEFT JOIN public.three_brand_fx_release_control c ON c.singleton=true
LEFT JOIN staging.three_brand_fx_sidecar s ON s.run_key=c.active_run_key AND s.listing_id=l.id;

-- Trading Floor retains WTS/WTB and genuine no-price activity. Price Research
-- is deliberately stricter: priced WTS watches only, with dated FX provenance.
CREATE OR REPLACE VIEW public.qnsa_three_brand_trading_floor_fx_contract
WITH (security_invoker=true) AS
SELECT l.*, e.effective_price_original, e.effective_currency, e.effective_price_usd,
  e.effective_conversion_rate, e.effective_conversion_source,
  e.effective_conversion_timestamp, e.sidecar_applied, e.sidecar_run_key,
  e.corrected_price_usd,e.corrected_source_amount,e.corrected_source_currency,
  e.corrected_fx_rate,e.corrected_fx_source,e.corrected_fx_date,
  e.price_correction_status,e.price_correction_id,e.price_correction_key
FROM staging.listings l
JOIN public.qnsa_three_brand_effective_prices e ON e.listing_id=l.id
WHERE l.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
  AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
  AND upper(COALESCE(l.listing_type,l.intent,'')) IN ('WTS','WTB')
  AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
  AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
  AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED');

CREATE OR REPLACE VIEW public.qnsa_three_brand_price_research_fx_contract
WITH (security_invoker=true) AS
SELECT l.*, e.effective_price_original AS effective_price_raw,
  e.effective_currency, e.effective_price_usd,
  e.effective_conversion_rate, e.effective_conversion_source,
  e.effective_conversion_timestamp,
  e.sidecar_applied, e.sidecar_run_key,e.corrected_price_usd,e.corrected_source_amount,
  e.corrected_source_currency,e.corrected_fx_rate,e.corrected_fx_source,e.corrected_fx_date,
  e.price_correction_status,e.price_correction_id,e.price_correction_key
FROM staging.listings l
JOIN public.qnsa_three_brand_effective_prices e ON e.listing_id=l.id
WHERE l.brand_normalized IN ('Rolex','Patek Philippe','Audemars Piguet')
  AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
  AND upper(COALESCE(l.listing_type,l.intent,''))='WTS' AND e.effective_price_usd > 0
  AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
  AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
  AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
  AND (e.effective_currency IN ('USD','USDT') OR
    (e.effective_conversion_rate > 0 AND e.effective_conversion_source IS NOT NULL
      AND e.effective_conversion_timestamp IS NOT NULL));

-- Bounded RPCs prevent the API's RPC-first path from bypassing the overlay.
CREATE OR REPLACE FUNCTION public.qnsa_three_brand_fx_price_research_rows(
  p_brand text,p_references text[],p_listing_type text,p_limit integer DEFAULT 1000)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,staging AS $$
  SELECT jsonb_build_object(
    'id',l.id::text,'brand',l.brand_normalized,'model',l.model_normalized,
    'reference',l.reference_normalized,'dial_color',l.dial_color_normalized,
    'condition',l.condition_normalized,'listing_type',upper(COALESCE(l.listing_type,l.intent,'')),
    'verdict',l.verdict,'confidence',l.overall_confidence,'raw_message',l.raw_message_text,
    'dealer_id',l.company_id::text,'source','MARIADB_IMMUTABLE_RAW','seller_name',COALESCE(l.user_name,l.from_name),
    'seller_phone',COALESCE(l.contact_number,l.from_number),'seller_rating',COALESCE(l.dealer_rating,l.rating),
    'location',l.location,'thumbnail_url',CASE WHEN btrim(COALESCE(l.image_url,l.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$' THEN btrim(COALESCE(l.image_url,l.source_media_url_candidate)) END,
    'image_urls',CASE WHEN btrim(COALESCE(l.image_url,l.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$' THEN jsonb_build_array(btrim(COALESCE(l.image_url,l.source_media_url_candidate))) ELSE '[]'::jsonb END,
    'has_images',btrim(COALESCE(l.image_url,l.source_media_url_candidate,''))~*'^https?://[^[:space:]]+$',
    'price_raw',CASE WHEN upper(p_listing_type)='WTS' THEN e.effective_price_original END,
    'price_usd',CASE WHEN upper(p_listing_type)='WTS' THEN e.effective_price_usd END,
    'currency',CASE WHEN upper(p_listing_type)='WTS' THEN e.effective_currency END,
    'corrected_price_usd',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_price_usd END,
    'corrected_source_amount',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_source_amount END,
    'corrected_source_currency',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_source_currency END,
    'corrected_fx_rate',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_fx_rate END,
    'corrected_fx_source',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_fx_source END,
    'corrected_fx_date',CASE WHEN upper(p_listing_type)='WTS' THEN e.corrected_fx_date END,
    'price_correction_status',CASE WHEN upper(p_listing_type)='WTS' THEN e.price_correction_status END,
    'price_correction_id',CASE WHEN upper(p_listing_type)='WTS' THEN e.price_correction_id END,
    'price_correction_key',CASE WHEN upper(p_listing_type)='WTS' THEN e.price_correction_key END,
    'created_at',l.created_at,'listing_date',l.created_at,'listing_status',l.trading_floor_status,
    'owner_reviewed_identity',true)
  FROM staging.listings l JOIN public.qnsa_three_brand_effective_prices e ON e.listing_id=l.id
  JOIN public.qnsa_two_brand_release_control control ON control.canonical_brand=l.brand_normalized
    AND control.enabled_run_key=l.normalization_run_key
  WHERE l.brand_normalized=p_brand AND l.reference_normalized=ANY(p_references)
    AND upper(COALESCE(l.listing_type,l.intent,''))=upper(p_listing_type)
    AND ((upper(p_listing_type)='WTB' AND control.price_research_enabled)
      OR (upper(p_listing_type)='WTS' AND control.price_research_enabled AND e.effective_price_usd>0
        AND (e.effective_currency IN ('USD','USDT') OR (e.effective_conversion_rate>0
          AND e.effective_conversion_source IS NOT NULL AND e.effective_conversion_timestamp IS NOT NULL))))
    AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL AND NOT COALESCE(l.is_bundle,false)
    AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
  ORDER BY l.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,1000),1),2500)
$$;

CREATE OR REPLACE FUNCTION public.qnsa_three_brand_fx_trading_floor_rows(
  p_brand text,p_limit integer DEFAULT 51,p_offset integer DEFAULT 0,p_listing_type text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,staging AS $$
  SELECT to_jsonb(t) FROM public.qnsa_three_brand_trading_floor_fx_contract t
  JOIN public.qnsa_two_brand_release_control control ON control.canonical_brand=t.brand_normalized
    AND control.enabled_run_key=t.normalization_run_key AND control.trading_floor_enabled
  WHERE (p_brand IS NULL OR t.brand_normalized=p_brand)
    AND (p_listing_type IS NULL OR upper(COALESCE(t.listing_type,t.intent,''))=upper(p_listing_type))
  ORDER BY (t.effective_price_usd IS NOT NULL) DESC,t.created_at DESC,t.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,51),1),101) OFFSET GREATEST(COALESCE(p_offset,0),0)
$$;

REVOKE ALL ON public.qnsa_three_brand_effective_prices,
  public.qnsa_three_brand_trading_floor_fx_contract,
  public.qnsa_three_brand_price_research_fx_contract FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qnsa_three_brand_effective_prices,
  public.qnsa_three_brand_trading_floor_fx_contract,
  public.qnsa_three_brand_price_research_fx_contract TO service_role;
REVOKE ALL ON FUNCTION public.activate_three_brand_fx_sidecar(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_three_brand_fx_sidecar(text) TO service_role;
REVOKE ALL ON FUNCTION public.qnsa_three_brand_fx_price_research_rows(text,text[],text,integer),
  public.qnsa_three_brand_fx_trading_floor_rows(text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qnsa_three_brand_fx_price_research_rows(text,text[],text,integer),
  public.qnsa_three_brand_fx_trading_floor_rows(text,integer,integer,text) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.start_three_brand_fx_sidecar(text,text,text,jsonb),
  public.discover_three_brand_fx_sidecar_candidates(text,integer),
  public.three_brand_fx_sidecar_page(text,integer),public.apply_three_brand_fx_sidecar_batch(text,text,jsonb),
  public.advance_three_brand_fx_sidecar(text,uuid,uuid,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_three_brand_fx_sidecar(text,text,text,jsonb),
  public.discover_three_brand_fx_sidecar_candidates(text,integer),
  public.three_brand_fx_sidecar_page(text,integer),public.apply_three_brand_fx_sidecar_batch(text,text,jsonb),
  public.advance_three_brand_fx_sidecar(text,uuid,uuid,bigint,bigint,bigint) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
