-- Append-only source-reviewed literal asks. Installation changes no inventory.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.reviewed_literal_source_prices_v2 (
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,proposal_hash text NOT NULL,
 price_resolution_hash text NOT NULL UNIQUE CHECK(price_resolution_hash ~ '^[a-f0-9]{64}$'),
 evidence_document jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(raw_row_id,source_hash,proposal_hash),
 CHECK(encode(sha256(convert_to(evidence_document::text,'UTF8')),'hex')=price_resolution_hash)
);
ALTER TABLE wf_canonical_staging.reviewed_literal_source_prices_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.reviewed_literal_source_prices_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.resolve_reviewed_literal_source_price_v2(p_raw_id uuid,p_proposal_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $resolve$
DECLARE entry wf_canonical_staging.reviewed_literal_source_prices_v2;
 raw wf_canonical_staging.mariadb_raw_source_rows;prior wf_canonical_staging.mariadb_normalized_proposals;
 fx wf_canonical_staging.verified_fx_evidence_v2;d jsonb;p jsonb;q jsonb;source_text text;token text;digits text;
 currency text;amount numeric;rate numeric;usd numeric;fx_source text;fx_date date;start_at integer;custom boolean;
BEGIN
 SELECT * INTO entry FROM wf_canonical_staging.reviewed_literal_source_prices_v2 WHERE raw_row_id=p_raw_id AND proposal_hash=p_proposal_hash;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO STRICT raw FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.mariadb_normalized_proposals
 WHERE(source_system,source_database,source_table,source_id,source_hash)=(raw.source_system,raw.source_database,raw.source_table,raw.source_id,raw.source_hash);
 d=entry.evidence_document;p=prior.proposal_document;q=d->'currency_evidence';
 source_text=raw.raw_payload->>(q->>'field');token=q->>'quote';start_at=(q->>'start_codepoints')::integer;
 amount=(d->>'original_price_amount')::numeric;currency=d->>'original_price_currency';
 IF d->>'contract' IS DISTINCT FROM 'WF_REVIEWED_LITERAL_SOURCE_PRICE_V1'
  OR d->>'raw_row_id' IS DISTINCT FROM raw.id::text OR d->>'source_hash' IS DISTINCT FROM raw.source_hash
  OR entry.source_hash IS DISTINCT FROM raw.source_hash OR d->>'proposal_hash' IS DISTINCT FROM prior.proposal_hash
  OR prior.proposal_hash IS DISTINCT FROM p_proposal_hash
  OR encode(sha256(convert_to(raw.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM raw.source_hash
  OR raw.raw_payload_text::jsonb IS DISTINCT FROM raw.raw_payload OR raw.raw_payload ? '_lossless_raw_evidence'
  OR encode(sha256(convert_to(prior.proposal_canonical_json,'UTF8')),'hex') IS DISTINCT FROM prior.proposal_hash
  OR prior.proposal_canonical_json::jsonb IS DISTINCT FROM p
  OR encode(sha256(convert_to(d::text,'UTF8')),'hex') IS DISTINCT FROM entry.price_resolution_hash
  OR coalesce(d->>'review_manifest_sha256','') !~ '^[a-f0-9]{64}$'
  OR p->>'intent' IS DISTINCT FROM 'WTS' OR p->'is_bundle' IS DISTINCT FROM 'false'::jsonb
  OR p->'trading_floor_eligible' IS DISTINCT FROM 'true'::jsonb
  OR p->>'original_price_amount' IS NOT NULL OR p->>'original_price_currency' IS NOT NULL
  OR q->>'field' IS DISTINCT FROM p->>'listing_text_source' OR q->>'field' NOT IN('description','title','comments')
  OR source_text IS NULL OR encode(sha256(convert_to(source_text,'UTF8')),'hex') IS DISTINCT FROM q->>'field_sha256'
  OR start_at IS NULL OR start_at<0 OR token IS NULL OR token=''
  OR substr(source_text,start_at+1,length(token)) IS DISTINCT FROM token
  OR (length(source_text)-length(replace(source_text,token,'')))/length(token)<>1
  OR (start_at>0 AND substr(source_text,start_at,1) ~ '[[:alnum:].,]')
  OR (start_at+length(token)<length(source_text) AND substr(source_text,start_at+length(token)+1,1) ~ '[[:alnum:]]')
  OR amount IS NULL OR amount<=0 OR currency NOT IN('USD','EUR','GBP','HKD') THEN
  RAISE EXCEPTION 'literal_price_source_evidence_changed' USING ERRCODE='22023'; END IF;
 -- Reviewed cohort uses explicit integral amounts and complete currency tokens.
 -- No location, bare dollar, decimal shorthand, peg or multiplier inference.
 IF currency='EUR' AND token ~* '^[0-9][0-9., ]*(,-)?[[:space:]]*(EUR|EURO|€)$' THEN
  digits=regexp_replace(token,'(,-)?[[:space:]]*(EUR|EURO|€)$','','i');
 ELSIF currency='GBP' AND token ~* '^[0-9][0-9., ]*[[:space:]]+GBP$' THEN digits=regexp_replace(token,'[[:space:]]+GBP$','','i');
 ELSIF currency='USD' AND token ~* '^[$]?[[:space:]]*[0-9][0-9., ]*(/-)?[[:space:]]*USD$' THEN
  digits=regexp_replace(regexp_replace(token,'^[$]?[[:space:]]*',''),'(/-)?[[:space:]]*USD$','','i');
 ELSIF currency='HKD' AND token ~* '^HKD[[:space:]]*(-[[:space:]]*)?[0-9][0-9., ]*$' THEN
  digits=regexp_replace(token,'^HKD[[:space:]]*(-[[:space:]]*)?','','i');
 ELSE RAISE EXCEPTION 'literal_price_currency_token_invalid' USING ERRCODE='22023'; END IF;
 digits=btrim(digits);
 IF digits !~ '^([0-9]+|[0-9]{1,3}([., ][0-9]{3})+)$'
  OR regexp_replace(digits,'[., ]','','g')::numeric IS DISTINCT FROM amount THEN
  RAISE EXCEPTION 'literal_price_amount_token_invalid' USING ERRCODE='22023'; END IF;
 IF currency='USD' THEN
  IF d->>'fx_evidence_hash' IS NOT NULL THEN RAISE EXCEPTION 'literal_price_usd_fx_invalid' USING ERRCODE='22023'; END IF;
  rate=1;fx_source='1:1_PARITY_PROOF';fx_date=(p->>'fx_date')::date;
 ELSE
  SELECT * INTO STRICT fx FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=d->>'fx_evidence_hash';
  IF fx.evidence_hash IS DISTINCT FROM encode(sha256(convert_to(fx.canonical_json,'UTF8')),'hex')
   OR fx.canonical_json::jsonb IS DISTINCT FROM fx.document OR fx.document->>'provider' IS DISTINCT FROM 'ECB' THEN
   RAISE EXCEPTION 'literal_price_fx_evidence_changed' USING ERRCODE='22023'; END IF;
  rate=(fx.document->'usd_per_unit'->>currency)::numeric;fx_date=(fx.document->>'observed_date')::date;fx_source='ECB:'||fx.evidence_hash;
  IF rate IS NULL OR rate<=0 THEN RAISE EXCEPTION 'literal_price_fx_rate_missing' USING ERRCODE='22023'; END IF;
 END IF;
 usd=round(amount*rate,2);
 custom=source_text ~* '(^|[^[:alnum:]])after[[:space:]-]*market([^[:alnum:]]|$)';
 IF custom IS DISTINCT FROM (d->'customization_disclosed'='true'::jsonb) THEN
  RAISE EXCEPTION 'literal_price_customization_proof_changed' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('price_resolution_hash',entry.price_resolution_hash,'original_price_amount',amount,
  'original_price_currency',currency,'original_price_text',token,'price_usd',usd,'fx_rate',rate,'fx_source',fx_source,'fx_date',fx_date,
  'price_status',CASE currency WHEN 'USD' THEN 'VERIFIED_USD' ELSE 'EXPLICIT_FX_CONVERTED' END,
  'price_research_eligible',usd BETWEEN 100 AND 500000 AND NOT custom,
  'included_in_statistics',usd BETWEEN 100 AND 500000 AND NOT custom,
  'statistics_exclusion_reason',CASE WHEN custom THEN 'SOURCE_CUSTOMIZATION_REQUIRES_RESEARCH_REVIEW'
   WHEN usd NOT BETWEEN 100 AND 500000 THEN 'PRICE_OUTLIER_HELD' ELSE NULL END,
  'fx_evidence_hash',d->'fx_evidence_hash','customization_disclosed',custom);
END $resolve$;
REVOKE ALL ON FUNCTION wf_canonical_staging.resolve_reviewed_literal_source_price_v2(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.record_reviewed_literal_source_prices_v2(p_documents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $record$
DECLARE d jsonb;h text;prior wf_canonical_staging.reviewed_literal_source_prices_v2;proof jsonb;result jsonb='[]';
BEGIN
 IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 23
  OR (SELECT count(DISTINCT value->>'raw_row_id') FROM jsonb_array_elements(p_documents))<>jsonb_array_length(p_documents) THEN
  RAISE EXCEPTION 'literal_price_batch_invalid' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
  h=encode(sha256(convert_to(d::text,'UTF8')),'hex');
  INSERT INTO wf_canonical_staging.reviewed_literal_source_prices_v2(raw_row_id,source_hash,proposal_hash,price_resolution_hash,evidence_document)
  VALUES((d->>'raw_row_id')::uuid,d->>'source_hash',d->>'proposal_hash',h,d) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT prior FROM wf_canonical_staging.reviewed_literal_source_prices_v2
  WHERE raw_row_id=(d->>'raw_row_id')::uuid AND source_hash=d->>'source_hash' AND proposal_hash=d->>'proposal_hash';
  IF prior.price_resolution_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'literal_price_replay_changed' USING ERRCODE='22023'; END IF;
  proof=wf_canonical_staging.resolve_reviewed_literal_source_price_v2(prior.raw_row_id,prior.proposal_hash);
  result=result||jsonb_build_array(jsonb_build_object('raw_row_id',prior.raw_row_id,'price_resolution_hash',h,'proof',proof));
 END LOOP;
 RETURN result;
END $record$;
REVOKE ALL ON FUNCTION wf_canonical_staging.record_reviewed_literal_source_prices_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.verify_reviewed_literal_price_materialization_v2(p_raw_id uuid,p_proposal_hash text,p_fx_hash text,p_evidence jsonb,p_document jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb;
BEGIN
 proof=wf_canonical_staging.resolve_reviewed_literal_source_price_v2(p_raw_id,p_proposal_hash);
 IF proof IS NULL THEN RETURN p_evidence->>'price_resolution_hash' IS NULL; END IF;
 RETURN p_evidence->>'price_resolution_hash' IS NOT DISTINCT FROM proof->>'price_resolution_hash'
  AND p_fx_hash IS NOT DISTINCT FROM proof->>'fx_evidence_hash'
  AND p_document @> (proof-'price_resolution_hash'-'fx_evidence_hash'-'customization_disclosed');
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.verify_reviewed_literal_price_materialization_v2(uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text;needle text;
BEGIN
 definition=replace(pg_get_functiondef('wf_canonical_staging.materialize_single_member_v2(text,uuid,text,text,text)'::regprocedure),chr(13),'');
 needle='DECLARE normalization_recovery jsonb;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_price_materializer_declaration_changed'; END IF;
 definition=replace(definition,needle,'DECLARE reviewed_price jsonb; normalization_recovery jsonb;');
 needle='  amount=(d->>''original_price_amount'')::numeric; currency=d->>''original_price_currency'';';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_price_materializer_price_changed'; END IF;
 definition=replace(definition,needle,$price$  reviewed_price=wf_canonical_staging.resolve_reviewed_literal_source_price_v2(r.id,p_proposal_hash);
  IF reviewed_price IS NOT NULL THEN
   IF p_fx_hash IS DISTINCT FROM reviewed_price->>'fx_evidence_hash' THEN RAISE EXCEPTION 'literal_price_materialization_fx_changed' USING ERRCODE='22023'; END IF;
   d=d||jsonb_build_object('original_price_amount',reviewed_price->'original_price_amount','original_price_currency',reviewed_price->'original_price_currency',
    'currency_status',CASE reviewed_price->>'original_price_currency' WHEN 'USD' THEN 'VERIFIED_EXPLICIT_USD' ELSE 'VERIFIED_EXPLICIT_CURRENCY' END);
   reasons=reasons-'MISSING_PRICE_OR_CURRENCY'-'AMBIGUOUS_BARE_DOLLAR_HELD';
  END IF;
$price$||needle);
 needle=' evidence=jsonb_build_object(''contract'',''wf-private-single-materialization-v2''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_price_materializer_evidence_changed'; END IF;
 definition=replace(definition,needle,$doc$ IF reviewed_price IS NOT NULL THEN
  doc=doc||(reviewed_price-'price_resolution_hash'-'fx_evidence_hash'-'customization_disclosed');
  IF reviewed_price->>'statistics_exclusion_reason'='SOURCE_CUSTOMIZATION_REQUIRES_RESEARCH_REVIEW' THEN
   reasons=reasons||'"SOURCE_CUSTOMIZATION_REQUIRES_RESEARCH_REVIEW"'::jsonb;
  END IF;
  doc=doc||jsonb_build_object('review_reasons',reasons,'review_status',CASE WHEN jsonb_array_length(reasons)>0 THEN 'REVIEW_REQUIRED' ELSE 'REVIEW_NOT_REQUIRED' END);
 END IF;
$doc$||needle);
 needle='materialization_hash=encode(extensions.digest(convert_to(evidence::text,''UTF8''),''sha256''),''hex'');';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_price_materializer_hash_changed'; END IF;
 definition=replace(definition,needle,E'IF reviewed_price IS NOT NULL THEN evidence=evidence||jsonb_build_object(''price_resolution_hash'',reviewed_price->>''price_resolution_hash''); END IF;\n '||needle);
 EXECUTE definition;
 definition=replace(pg_get_functiondef('wf_canonical_staging.publish_materialized_batch_v2(text,bigint,text[],boolean)'::regprocedure),chr(13),'');
 needle='  ) THEN RAISE EXCEPTION ''publication_source_identity_requires_review'' USING ERRCODE=''22023''; END IF;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'literal_price_publisher_proof_changed'; END IF;
 definition=replace(definition,needle,needle||E'\n  IF NOT wf_canonical_staging.verify_reviewed_literal_price_materialization_v2(r.id,v.proposal_hash,v.fx_evidence_hash,v.evidence_document,v.document) THEN\n   RAISE EXCEPTION ''publication_reviewed_price_evidence_changed'' USING ERRCODE=''22023''; END IF;');
 EXECUTE definition;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
