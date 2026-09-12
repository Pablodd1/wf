-- One independently captured official CBUAE observation for reviewed AED/SAR asks.
-- Existing ECB evidence and all source/proposal/publication rows remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.validate_reviewed_cbuae_fx_v2(d jsonb,canonical text,h text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $validate$
DECLARE source text;usd_values text[];sar_values text[];usd_aed numeric;sar_aed numeric;rates jsonb;
BEGIN
 source=d->>'raw_html';
 IF d IS NULL OR canonical IS NULL OR h IS NULL OR source IS NULL OR octet_length(source)>2000000
  OR h !~ '^[a-f0-9]{64}$' OR canonical::jsonb IS DISTINCT FROM d
  OR encode(sha256(convert_to(canonical,'UTF8')),'hex') IS DISTINCT FROM h
  OR d->>'contract' IS DISTINCT FROM 'wf-reviewed-cbuae-fx-evidence-v1'
  OR d->>'provider' IS DISTINCT FROM 'CBUAE'
  OR d->>'request_url' IS DISTINCT FROM 'https://centralbank.ae/umbraco/Surface/Exchange/GetExchangeRateAllCurrency'
  -- This hash was obtained by verified HTTPS GET from the exact official URL.
  -- A different page, rate date or capture is not authorized by this migration.
  OR d->>'raw_html_sha256' IS DISTINCT FROM 'bd46aa93c68e8699bc0dc0c88b0b1f3d0006d6ce7d736278b088ce863d78e4c3'
  OR encode(sha256(convert_to(source,'UTF8')),'hex') IS DISTINCT FROM d->>'raw_html_sha256'
  OR d->>'observed_date' IS DISTINCT FROM '2026-09-08'
  OR d->>'observed_at' IS DISTINCT FROM '2026-09-08T18:05:16+04:00'
  OR d->>'fetched_at' IS NULL
  OR (d->>'fetched_at')::timestamptz < (d->>'observed_at')::timestamptz
  OR (d->>'fetched_at')::timestamptz > (d->>'observed_at')::timestamptz+interval '10 days'
  OR source !~ 'Last updated:[[:space:]]*Tuesday 08 September 2026 06:05:16 PM' THEN
  RAISE EXCEPTION 'cbuae_official_source_evidence_changed' USING ERRCODE='22023'; END IF;
 SELECT array_agg(m[1]) INTO usd_values FROM regexp_matches(source,
  '<td[^>]*>US Dollar</td>[[:space:]]*<td[^>]*>([0-9]+[.][0-9]+)</td>','g') m;
 SELECT array_agg(m[1]) INTO sar_values FROM regexp_matches(source,
  '<td[^>]*>Saudi Riyal</td>[[:space:]]*<td[^>]*>([0-9]+[.][0-9]+)</td>','g') m;
 IF coalesce(array_length(usd_values,1),0)<>1 OR coalesce(array_length(sar_values,1),0)<>1 THEN
  RAISE EXCEPTION 'cbuae_official_rate_rows_invalid' USING ERRCODE='22023'; END IF;
 usd_aed=usd_values[1]::numeric;sar_aed=sar_values[1]::numeric;
 IF usd_aed<=0 OR sar_aed<=0 THEN RAISE EXCEPTION 'cbuae_official_rate_rows_invalid' USING ERRCODE='22023'; END IF;
 rates=jsonb_build_object('USD',1,'AED',round(1/usd_aed,18),'SAR',round(sar_aed/usd_aed,18));
 IF d->'aed_per_unit' IS DISTINCT FROM jsonb_build_object('AED',1,'USD',usd_aed,'SAR',sar_aed)
  OR d->'usd_per_unit' IS DISTINCT FROM rates THEN
  RAISE EXCEPTION 'cbuae_cross_rates_changed' USING ERRCODE='22023'; END IF;
 RETURN true;
END $validate$;
REVOKE ALL ON FUNCTION wf_canonical_staging.validate_reviewed_cbuae_fx_v2(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.stage_reviewed_cbuae_fx_v2(d jsonb,canonical text,h text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stage$
DECLARE existing wf_canonical_staging.verified_fx_evidence_v2;inserted integer;
BEGIN
 PERFORM wf_canonical_staging.validate_reviewed_cbuae_fx_v2(d,canonical,h);
 INSERT INTO wf_canonical_staging.verified_fx_evidence_v2(evidence_hash,document,canonical_json)
 VALUES(h,d,canonical) ON CONFLICT(evidence_hash) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO STRICT existing FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=h;
 IF existing.document IS DISTINCT FROM d OR existing.canonical_json IS DISTINCT FROM canonical THEN
  RAISE EXCEPTION 'cbuae_evidence_identity_conflict' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('evidence_hash',h,'inserted',inserted,'identical',1-inserted,'provider','CBUAE','observed_date',d->>'observed_date');
END $stage$;
REVOKE ALL ON FUNCTION wf_canonical_staging.stage_reviewed_cbuae_fx_v2(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE wf_canonical_staging.reviewed_cbuae_source_prices_v2 (
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,proposal_hash text NOT NULL,price_resolution_hash text NOT NULL UNIQUE,
 evidence_document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(raw_row_id,source_hash,proposal_hash),
 CHECK(encode(sha256(convert_to(evidence_document::text,'UTF8')),'hex')=price_resolution_hash)
);
ALTER TABLE wf_canonical_staging.reviewed_cbuae_source_prices_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_cbuae_source_prices_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.verify_cbuae_source_quote_v2(payload jsonb,q jsonb,source_field text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE source text;token text;pos integer;
BEGIN
 source=payload->>source_field;token=q->>'quote';pos=(q->>'start_codepoints')::integer;
 IF source_field NOT IN('description','title','comments') OR source_field IS NULL
  OR q->>'field' IS DISTINCT FROM source_field OR source IS NULL OR token IS NULL OR token=''
  OR encode(sha256(convert_to(source,'UTF8')),'hex') IS DISTINCT FROM q->>'field_sha256'
  OR pos IS NULL OR pos<0 OR (q->>'end_codepoints')::integer IS DISTINCT FROM pos+length(token)
  OR substr(source,pos+1,length(token)) IS DISTINCT FROM token
  OR (length(source)-length(replace(source,token,'')))/length(token)<>1 THEN
  RAISE EXCEPTION 'cbuae_listing_source_quote_changed' USING ERRCODE='22023'; END IF;
 RETURN token;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.verify_cbuae_source_quote_v2(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.resolve_reviewed_cbuae_source_price_v2(p_raw_id uuid,p_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $resolve$
DECLARE entry wf_canonical_staging.reviewed_cbuae_source_prices_v2;raw wf_canonical_staging.mariadb_raw_source_rows;
 prior wf_canonical_staging.mariadb_normalized_proposals;fx wf_canonical_staging.verified_fx_evidence_v2;
 d jsonb;p jsonb;q jsonb;token text;source text;digits text;amount numeric;rate numeric;usd numeric;
 custom boolean;pos integer;false_token text;result jsonb;
BEGIN
 SELECT * INTO entry FROM wf_canonical_staging.reviewed_cbuae_source_prices_v2 WHERE raw_row_id=p_raw_id AND proposal_hash=p_hash;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO STRICT raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.mariadb_normalized_proposals
 WHERE(source_system,source_database,source_table,source_id,source_hash)=(raw.source_system,raw.source_database,raw.source_table,raw.source_id,raw.source_hash);
 d=entry.evidence_document;p=prior.proposal_document;q=d->'price_evidence';source=raw.raw_payload->>(p->>'listing_text_source');
 IF d->>'contract' IS DISTINCT FROM 'WF_REVIEWED_CBUAE_SOURCE_PRICE_V1'
  OR d->>'review_manifest_sha256' IS DISTINCT FROM '7db63096aaeb5d621b0e34a721d8f51b263b8d73c1ba842f73c8c6f3346bc717'
  OR d->>'raw_row_id' IS DISTINCT FROM raw.id::text OR d->>'source_hash' IS DISTINCT FROM raw.source_hash
  OR entry.source_hash IS DISTINCT FROM raw.source_hash OR d->>'proposal_hash' IS DISTINCT FROM prior.proposal_hash OR prior.proposal_hash IS DISTINCT FROM p_hash
  OR encode(sha256(convert_to(raw.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM raw.source_hash
  OR raw.raw_payload_text::jsonb IS DISTINCT FROM raw.raw_payload OR raw.raw_payload ? '_lossless_raw_evidence'
  OR encode(sha256(convert_to(prior.proposal_canonical_json,'UTF8')),'hex') IS DISTINCT FROM prior.proposal_hash
  OR prior.proposal_canonical_json::jsonb IS DISTINCT FROM p
  OR encode(sha256(convert_to(d::text,'UTF8')),'hex') IS DISTINCT FROM entry.price_resolution_hash
  OR p->>'intent' IS DISTINCT FROM 'WTS' OR p->'is_bundle' IS DISTINCT FROM 'false'::jsonb
  OR p->'trading_floor_eligible' IS DISTINCT FROM 'true'::jsonb
  OR d->'expected_original_price_amount' IS DISTINCT FROM p->'original_price_amount'
  OR d->'expected_original_price_currency' IS DISTINCT FROM p->'original_price_currency' THEN
  RAISE EXCEPTION 'cbuae_listing_source_evidence_changed' USING ERRCODE='22023'; END IF;
 token=wf_canonical_staging.verify_cbuae_source_quote_v2(raw.raw_payload,q,p->>'listing_text_source');pos=(q->>'start_codepoints')::integer;
 IF (pos>0 AND substr(source,pos,1) ~ '[[:alnum:].,]')
  OR (pos+length(token)<length(source) AND substr(source,pos+length(token)+1,1) ~ '[[:alnum:]]') THEN
  RAISE EXCEPTION 'cbuae_listing_price_token_boundary_invalid' USING ERRCODE='22023'; END IF;
 IF d->>'price_outcome'='AMBIGUOUS_CURRENCY' THEN
  false_token=wf_canonical_staging.verify_cbuae_source_quote_v2(raw.raw_payload,d->'false_reference_price_evidence',p->>'listing_text_source');
  IF p->>'original_price_currency' IS DISTINCT FROM 'SAR' OR false_token IS DISTINCT FROM p->>'reference'
   OR false_token !~ '^[0-9]+SARU$' OR regexp_replace(false_token,'SARU$','')::numeric IS DISTINCT FROM (p->>'original_price_amount')::numeric
   OR token !~ '^[$][0-9]+([.][0-9]+)?[Kk]?$' OR source ~* '(^|[^[:alnum:]])(USD|SAR)([^[:alnum:]]|$)|US[$]'
   OR d->>'approved_original_price_amount' IS NOT NULL OR d->>'approved_original_price_currency' IS NOT NULL
   OR d->>'fx_evidence_hash' IS NOT NULL OR d->'customization_disclosed' IS DISTINCT FROM 'false'::jsonb THEN
   RAISE EXCEPTION 'cbuae_false_reference_price_hold_invalid' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('price_resolution_hash',entry.price_resolution_hash,'original_price_amount',NULL,'original_price_currency',NULL,
   'original_price_text',token,'price_usd',NULL,'fx_rate',NULL,'fx_source',NULL,'fx_date',NULL,'price_status','UNRESOLVED_CURRENCY',
   'price_research_eligible',false,'included_in_statistics',false,'statistics_exclusion_reason','SOURCE_CURRENCY_NOT_ESTABLISHED',
   'fx_evidence_hash',NULL,'customization_disclosed',false);
 END IF;
 amount=(d->>'approved_original_price_amount')::numeric;
 IF d->>'price_outcome' IS DISTINCT FROM 'DATED_CBUAE_FX' OR d->>'approved_original_price_currency' IS DISTINCT FROM 'AED'
  OR amount IS NULL OR amount<=0 OR (p->>'original_price_currency' IS NOT NULL AND p->>'original_price_currency'<>'AED')
  OR (p->>'original_price_amount' IS NOT NULL AND (p->>'original_price_amount')::numeric IS DISTINCT FROM amount) THEN
  RAISE EXCEPTION 'cbuae_listing_price_outcome_invalid' USING ERRCODE='22023'; END IF;
 IF token ~* '^AED[[:space:]]+[0-9][0-9,.]*[Kk]?$' THEN digits=regexp_replace(token,'^AED[[:space:]]+','','i');
 ELSIF token ~* '^[0-9][0-9,.]*[Kk]?(/-)?[[:space:]]+AED$' THEN digits=regexp_replace(token,'(/-)?[[:space:]]+AED$','','i');
 ELSE RAISE EXCEPTION 'cbuae_listing_currency_token_invalid' USING ERRCODE='22023'; END IF;
 IF digits !~ '^([0-9]+|[0-9]{1,3}(,[0-9]{3})+)([.][0-9]+)?[Kk]?$'
  OR replace(regexp_replace(digits,'[Kk]$',''),',','')::numeric*(CASE WHEN digits ~ '[Kk]$' THEN 1000 ELSE 1 END) IS DISTINCT FROM amount THEN
  RAISE EXCEPTION 'cbuae_listing_amount_token_invalid' USING ERRCODE='22023'; END IF;
 custom=source ~* '(^|[^[:alnum:]])date[[:space:]]+change[[:space:]]+and[[:space:]]+dial[[:space:]]+swap([^[:alnum:]]|$)';
 IF d->'customization_disclosed' IS DISTINCT FROM to_jsonb(custom) THEN RAISE EXCEPTION 'cbuae_listing_customization_changed' USING ERRCODE='22023'; END IF;
 IF custom AND lower(wf_canonical_staging.verify_cbuae_source_quote_v2(raw.raw_payload,d->'customization_evidence',p->>'listing_text_source'))<>'date change and dial swap' THEN
  RAISE EXCEPTION 'cbuae_listing_customization_changed' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT fx FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=d->>'fx_evidence_hash';
 PERFORM wf_canonical_staging.validate_reviewed_cbuae_fx_v2(fx.document,fx.canonical_json,fx.evidence_hash);
 rate=(fx.document#>>'{usd_per_unit,AED}')::numeric;usd=round(amount*rate,2);
 RETURN jsonb_build_object('price_resolution_hash',entry.price_resolution_hash,'original_price_amount',amount,'original_price_currency','AED',
  'original_price_text',token,'price_usd',usd,'fx_rate',rate,'fx_source','CBUAE:'||fx.evidence_hash,'fx_date',(fx.document->>'observed_date')::date,
  'price_status','EXPLICIT_FX_CONVERTED','price_research_eligible',usd BETWEEN 100 AND 500000 AND NOT custom,
  'included_in_statistics',usd BETWEEN 100 AND 500000 AND NOT custom,'statistics_exclusion_reason',CASE WHEN custom THEN 'SOURCE_CUSTOMIZATION_REQUIRES_RESEARCH_REVIEW'
  WHEN usd NOT BETWEEN 100 AND 500000 THEN 'PRICE_OUTLIER_HELD' ELSE NULL END,'fx_evidence_hash',fx.evidence_hash,'customization_disclosed',custom);
END $resolve$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_reviewed_cbuae_source_price_v2(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.record_reviewed_cbuae_source_prices_v2(documents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb;h text;existing wf_canonical_staging.reviewed_cbuae_source_prices_v2;proof jsonb;result jsonb='[]';
BEGIN
 IF jsonb_typeof(documents) IS DISTINCT FROM 'array' OR jsonb_array_length(documents) NOT BETWEEN 1 AND 65
  OR (SELECT count(DISTINCT value->>'raw_row_id') FROM jsonb_array_elements(documents))<>jsonb_array_length(documents) THEN
  RAISE EXCEPTION 'cbuae_listing_batch_invalid' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(documents) LOOP
  h=encode(sha256(convert_to(d::text,'UTF8')),'hex');
  INSERT INTO wf_canonical_staging.reviewed_cbuae_source_prices_v2(raw_row_id,source_hash,proposal_hash,price_resolution_hash,evidence_document)
  VALUES((d->>'raw_row_id')::uuid,d->>'source_hash',d->>'proposal_hash',h,d) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT existing FROM wf_canonical_staging.reviewed_cbuae_source_prices_v2 WHERE raw_row_id=(d->>'raw_row_id')::uuid AND source_hash=d->>'source_hash' AND proposal_hash=d->>'proposal_hash';
  IF existing.price_resolution_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'cbuae_listing_replay_changed' USING ERRCODE='22023'; END IF;
  proof=wf_canonical_staging.resolve_reviewed_cbuae_source_price_v2(existing.raw_row_id,existing.proposal_hash);
  result=result||jsonb_build_array(jsonb_build_object('raw_row_id',existing.raw_row_id,'price_resolution_hash',h,'proof',proof));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.record_reviewed_cbuae_source_prices_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text;needle text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)'::regprocedure),chr(13),'');
 needle='rate=(fx.document->''usd_per_unit''->>currency)::numeric;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'cbuae_materializer_rate_contract_changed'; END IF;
 definition=replace(definition,needle,$check$IF fx.document->>'provider'='CBUAE' THEN
    IF currency IS DISTINCT FROM 'AED' THEN RAISE EXCEPTION 'cbuae_currency_not_reviewed' USING ERRCODE='22023'; END IF;
    IF reviewed_price IS NULL OR reviewed_price->>'fx_evidence_hash' IS DISTINCT FROM p_fx_hash THEN
     RAISE EXCEPTION 'cbuae_listing_review_required' USING ERRCODE='22023'; END IF;
    PERFORM wf_canonical_staging.validate_reviewed_cbuae_fx_v2(fx.document,fx.canonical_json,fx.evidence_hash);
   ELSIF fx.document->>'provider' IS DISTINCT FROM 'ECB' THEN
    RAISE EXCEPTION 'materialization_fx_provider_unverified' USING ERRCODE='22023';
   END IF;
   $check$||needle);
 needle='fx_source=''ECB:''||p_fx_hash;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'cbuae_materializer_label_contract_changed'; END IF;
 definition=replace(definition,needle,'fx_source=(fx.document->>''provider'')||'':''||p_fx_hash;');
 needle='reasons=reasons-''MISSING_PRICE_OR_CURRENCY''-''AMBIGUOUS_BARE_DOLLAR_HELD'';';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'cbuae_materializer_review_reason_contract_changed'; END IF;
 definition=replace(definition,needle,needle||E'\n   IF reviewed_price->>''statistics_exclusion_reason''=''SOURCE_CURRENCY_NOT_ESTABLISHED'' THEN reasons=(reasons-''FX_UNRESOLVED_HELD'')||''"SOURCE_CURRENCY_NOT_ESTABLISHED"''::jsonb; END IF;');
 EXECUTE definition;

 -- Reuse the installed materializer/publisher exact reviewed-price proof hook.
 -- Existing ECB/USD reviewed prices continue through their original resolver.
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_reviewed_literal_source_price_v2(uuid,text)'::regprocedure),chr(13),'');
 needle=' SELECT * INTO entry FROM wf_canonical_staging.reviewed_literal_source_prices_v2';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'cbuae_literal_price_resolver_contract_changed'; END IF;
 definition=replace(definition,needle,E' d=wf_canonical_staging.resolve_reviewed_cbuae_source_price_v2(p_raw_id,p_proposal_hash);\n IF d IS NOT NULL THEN RETURN d; END IF;\n'||needle);
 EXECUTE definition;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
