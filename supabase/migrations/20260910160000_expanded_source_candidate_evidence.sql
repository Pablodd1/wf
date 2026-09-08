-- Additive, private evidence for the owner's September 8 publication policy.
-- Raw rows and historical normalization/materialization versions are immutable.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE wf_canonical_staging.expanded_publication_policies_v3 (
 policy_hash text PRIMARY KEY CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 parser_version text NOT NULL,
 dependency_hashes jsonb NOT NULL,
 review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wf_canonical_staging.expanded_listing_candidates_v3 (
 candidate_hash text PRIMARY KEY CHECK(candidate_hash ~ '^[a-f0-9]{64}$'),
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,
 policy_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_publication_policies_v3(policy_hash),
 parent_source_field text NOT NULL CHECK(parent_source_field IN('title','description','comments')),
 parent_field_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN('SINGLE','CHILD')),
 child_index integer,
 -- Store canonical bytes once; do not also copy the full JSON or parent message.
 canonical_json text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(encode(sha256(convert_to(canonical_json,'UTF8')),'hex')=candidate_hash),
 CHECK((kind='SINGLE' AND child_index IS NULL) OR (kind='CHILD' AND child_index>=1)),
 UNIQUE(raw_row_id,policy_hash,kind,child_index)
);
-- Exact hash membership is admitted only after the frozen JavaScript rebuild.
-- This prevents self-rehashed, source-adjacent invented facts from being staged.
CREATE TABLE wf_canonical_staging.expanded_candidate_admissions_v3 (
 candidate_hash text PRIMARY KEY CHECK(candidate_hash ~ '^[a-f0-9]{64}$'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 policy_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_publication_policies_v3(policy_hash),
 review_manifest_sha256 text NOT NULL CHECK(review_manifest_sha256 ~ '^[a-f0-9]{64}$')
);
ALTER TABLE wf_canonical_staging.expanded_candidate_admissions_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.expanded_candidate_admissions_v3 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX expanded_candidates_source_v3 ON wf_canonical_staging.expanded_listing_candidates_v3(raw_row_id,source_hash);
CREATE UNIQUE INDEX expanded_candidate_single_policy_v3 ON wf_canonical_staging.expanded_listing_candidates_v3(raw_row_id,policy_hash) WHERE kind='SINGLE';
CREATE TABLE wf_canonical_staging.expanded_listing_versions_v3 (
 materialization_hash text PRIMARY KEY CHECK(materialization_hash ~ '^[a-f0-9]{64}$'),
 candidate_hash text NOT NULL REFERENCES wf_canonical_staging.expanded_listing_candidates_v3(candidate_hash),
 listing_id text NOT NULL,
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL,
 document jsonb NOT NULL,
 fx_evidence_hash text REFERENCES wf_canonical_staging.verified_fx_evidence_v2(evidence_hash),
 image_evidence_hash text REFERENCES wf_canonical_staging.source_image_evidence_v2(evidence_hash),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(encode(sha256(convert_to(jsonb_build_array(candidate_hash,document,fx_evidence_hash,image_evidence_hash)::text,'UTF8')),'hex')=materialization_hash)
);
CREATE INDEX expanded_versions_listing_v3 ON wf_canonical_staging.expanded_listing_versions_v3(listing_id,source_hash);
ALTER TABLE wf_canonical_staging.expanded_publication_policies_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.expanded_listing_candidates_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.expanded_listing_versions_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.expanded_publication_policies_v3,wf_canonical_staging.expanded_listing_candidates_v3,
 wf_canonical_staging.expanded_listing_versions_v3 FROM PUBLIC,anon,authenticated,service_role;

-- Derived parsing view only: exact source spans/hashes remain unchanged.
-- Format characters are frozen from the pinned JavaScript Unicode property set.
CREATE FUNCTION wf_canonical_staging.expanded_parsing_view_v3(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT coalesce(string_agg(translate(normalize(cp,NFKC),U&'\00ad\0600\0601\0602\0603\0604\0605\061c\06dd\070f\0890\0891\08e2\180e\200b\200c\200d\200e\200f\202a\202b\202c\202d\202e\2060\2061\2062\2063\2064\2066\2067\2068\2069\206a\206b\206c\206d\206e\206f\feff\fff9\fffa\fffb\+0110bd\+0110cd\+013430\+013431\+013432\+013433\+013434\+013435\+013436\+013437\+013438\+013439\+01343a\+01343b\+01343c\+01343d\+01343e\+01343f\+01bca0\+01bca1\+01bca2\+01bca3\+01d173\+01d174\+01d175\+01d176\+01d177\+01d178\+01d179\+01d17a\+0e0001\+0e0020\+0e0021\+0e0022\+0e0023\+0e0024\+0e0025\+0e0026\+0e0027\+0e0028\+0e0029\+0e002a\+0e002b\+0e002c\+0e002d\+0e002e\+0e002f\+0e0030\+0e0031\+0e0032\+0e0033\+0e0034\+0e0035\+0e0036\+0e0037\+0e0038\+0e0039\+0e003a\+0e003b\+0e003c\+0e003d\+0e003e\+0e003f\+0e0040\+0e0041\+0e0042\+0e0043\+0e0044\+0e0045\+0e0046\+0e0047\+0e0048\+0e0049\+0e004a\+0e004b\+0e004c\+0e004d\+0e004e\+0e004f\+0e0050\+0e0051\+0e0052\+0e0053\+0e0054\+0e0055\+0e0056\+0e0057\+0e0058\+0e0059\+0e005a\+0e005b\+0e005c\+0e005d\+0e005e\+0e005f\+0e0060\+0e0061\+0e0062\+0e0063\+0e0064\+0e0065\+0e0066\+0e0067\+0e0068\+0e0069\+0e006a\+0e006b\+0e006c\+0e006d\+0e006e\+0e006f\+0e0070\+0e0071\+0e0072\+0e0073\+0e0074\+0e0075\+0e0076\+0e0077\+0e0078\+0e0079\+0e007a\+0e007b\+0e007c\+0e007d\+0e007e\+0e007f',''),'' ORDER BY ordinal),'')
 FROM regexp_split_to_table(p_text,'') WITH ORDINALITY AS p(cp,ordinal);
$$;
REVOKE ALL ON FUNCTION wf_canonical_staging.expanded_parsing_view_v3(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.verify_expanded_candidate_content_v3(p_raw_id uuid,p_policy_hash text,p_canonical text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r wf_canonical_staging.mariadb_raw_source_rows; pol wf_canonical_staging.expanded_publication_policies_v3;
 c jsonb; f jsonb; e jsonb; source text; span jsonb; field_name text; evidence_group jsonb; n integer; a integer; b integer;
 raw_number text; number_token text; scale_token text; computed_amount numeric; price_view text;
BEGIN
 IF p_canonical IS NULL OR octet_length(p_canonical)>1000000 OR p_hash IS NULL
  OR encode(sha256(convert_to(p_canonical,'UTF8')),'hex') IS DISTINCT FROM p_hash THEN
  RAISE EXCEPTION 'expanded_candidate_hash_invalid' USING ERRCODE='22023'; END IF;
 c=p_canonical::jsonb;f=c->'fields';e=c->'evidence';
 SELECT * INTO STRICT r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=p_raw_id;
 SELECT * INTO STRICT pol FROM wf_canonical_staging.expanded_publication_policies_v3 WHERE policy_hash=p_policy_hash;
 IF NOT EXISTS(SELECT 1 FROM wf_canonical_staging.expanded_candidate_admissions_v3 a WHERE a.candidate_hash=p_hash
  AND a.policy_hash=p_policy_hash AND a.source_hash=r.source_hash AND a.review_manifest_sha256=pol.review_manifest_sha256) THEN
  RAISE EXCEPTION 'expanded_candidate_not_in_reviewed_manifest' USING ERRCODE='22023'; END IF;
 IF r.raw_payload_text IS NULL OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence'
  OR encode(sha256(convert_to(r.raw_payload_text,'UTF8')),'hex') IS DISTINCT FROM r.source_hash
  OR (c->>'source_system',c->>'source_database',c->>'source_table',c->>'source_id',c->>'source_hash')
   IS DISTINCT FROM (r.source_system,r.source_database,r.source_table,r.source_id,r.source_hash)
  OR c->>'contract' IS DISTINCT FROM 'WF_EXPANDED_SOURCE_CANDIDATE_V1'
  OR c->>'parser_version' IS DISTINCT FROM pol.parser_version OR c->'dependency_hashes' IS DISTINCT FROM pol.dependency_hashes
  OR c->'decision'->>'trading_floor' IS DISTINCT FROM 'TF_SUPPORTED_CANDIDATE'
  OR c->'decision'->'reasons' IS DISTINCT FROM '[]'::jsonb
  OR f->>'category' IS DISTINCT FROM 'WATCH' OR f->>'intent' IS NULL OR f->>'intent' NOT IN('WTS','WTB')
  OR nullif(btrim(f->>'brand'),'') IS NULL OR nullif(btrim(f->>'reference'),'') IS NULL
  OR c->>'kind' IS NULL OR c->>'kind' NOT IN('SINGLE','CHILD') THEN
  RAISE EXCEPTION 'expanded_candidate_source_or_policy_invalid' USING ERRCODE='22023'; END IF;
 field_name=c->>'parent_source_field';source=r.raw_payload->>field_name;
 IF field_name NOT IN('title','description','comments') OR source IS NULL OR btrim(source)=''
  OR encode(sha256(convert_to(source,'UTF8')),'hex') IS DISTINCT FROM c->>'parent_field_hash'
  OR jsonb_typeof(c->'source_spans') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'source_spans')<1
  OR jsonb_typeof(c->'context_spans') IS DISTINCT FROM 'array' OR jsonb_typeof(e) IS DISTINCT FROM 'object'
  OR c->'source_spans'->0->>'quote' IS DISTINCT FROM c->>'source_context_text' THEN
  RAISE EXCEPTION 'expanded_parent_field_or_child_span_invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(c->'source_spans')>1 AND (c->>'kind' IS DISTINCT FROM 'CHILD'
  OR c->>'repeated_block_policy' IS DISTINCT FROM 'IDENTICAL_SOURCE_BLOCK_NOT_ADDITIONAL_UNIT') THEN
  RAISE EXCEPTION 'expanded_repeated_block_policy_invalid' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c->'source_spans') s
  WHERE s->>'role' IS DISTINCT FROM 'OFFER_BLOCK' OR NOT(s ? 'start') OR s->>'quote' IS DISTINCT FROM c->>'source_context_text') THEN
  RAISE EXCEPTION 'expanded_offer_block_not_exact' USING ERRCODE='22023'; END IF;
 IF (c->>'kind'='SINGLE' AND c->>'child_index' IS NOT NULL)
  OR (c->>'kind'='CHILD' AND (coalesce((c->>'child_index')::integer,0)<1 OR c->'images' IS DISTINCT FROM
   '{"image_key":null,"image_url":null,"primary_image_key":null,"primary_image_url":null,"thumbnail":null,"thumbnail_url":null,"image_urls":[],"images":[],"gallery":[]}'::jsonb)) THEN
  RAISE EXCEPTION 'expanded_child_image_or_identity_invalid' USING ERRCODE='22023'; END IF;
 -- PostgreSQL substring counts Unicode codepoints, matching the frozen proof.
 FOR span IN SELECT value FROM jsonb_array_elements(c->'source_spans')
  UNION ALL SELECT value FROM jsonb_array_elements(c->'context_spans')
 UNION ALL SELECT v.value FROM jsonb_each(e) g CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g.value)='array' THEN g.value ELSE '[]'::jsonb END) v LOOP
  IF jsonb_typeof(span) IS DISTINCT FROM 'object' OR nullif(span->>'field','') IS NULL OR nullif(span->>'role','') IS NULL THEN
   RAISE EXCEPTION 'expanded_evidence_shape_invalid' USING ERRCODE='22023'; END IF;
  IF span ? 'start' THEN
   a=(span->>'start')::integer;b=(span->>'end')::integer;
   IF span->>'field' IS DISTINCT FROM field_name OR span->>'field_sha256' IS DISTINCT FROM c->>'parent_field_hash'
    OR span->>'offset_unit' IS DISTINCT FROM 'UNICODE_CODEPOINT' OR span->'end_exclusive' IS DISTINCT FROM 'true'::jsonb
    OR a IS NULL OR b IS NULL OR a<0 OR b<=a OR b>char_length(source)
    OR substring(source FROM a+1 FOR b-a) IS DISTINCT FROM span->>'quote'
    OR encode(sha256(convert_to(span->>'quote','UTF8')),'hex') IS DISTINCT FROM span->>'quote_sha256' THEN
    RAISE EXCEPTION 'expanded_evidence_span_invalid' USING ERRCODE='22023'; END IF;
  ELSE
   IF span->>'field' NOT IN('brand','type','country') OR NOT(span ? 'value') OR span->'value'='null'::jsonb OR NOT(r.raw_payload ? (span->>'field'))
    OR span->'value' IS DISTINCT FROM r.raw_payload->(span->>'field')
    OR encode(sha256(convert_to((span->'value')::text,'UTF8')),'hex') IS DISTINCT FROM span->>'value_sha256'
    OR span->>'role' NOT IN('SOURCE_METADATA_CATALOG_CORROBORATED','NONCONFLICTING_SOURCE_TYPE','EXPLICIT_SOURCE_METADATA') THEN
    RAISE EXCEPTION 'expanded_metadata_evidence_invalid' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 IF coalesce(jsonb_array_length(e->'reference'),0)<>1 OR coalesce(jsonb_array_length(e->'brand'),0)<1
  OR coalesce(jsonb_array_length(e->'intent'),0)<1 THEN
  RAISE EXCEPTION 'expanded_required_field_proof_missing' USING ERRCODE='22023'; END IF;
 IF upper(regexp_replace(normalize(e->'reference'->0->>'quote',NFKC),'[^a-zA-Z0-9]','','g'))
  IS DISTINCT FROM upper(regexp_replace(f->>'reference','[^a-zA-Z0-9]','','g')) THEN
  RAISE EXCEPTION 'expanded_reference_not_source_exact' USING ERRCODE='22023'; END IF;
 IF c->>'intent_evidence_tier'='NONCONFLICTING_SOURCE_TYPE' AND f->>'intent' IS DISTINCT FROM
  (CASE lower(r.raw_payload->>'type') WHEN 'sale' THEN 'WTS' WHEN 'search' THEN 'WTB' END) THEN
  RAISE EXCEPTION 'expanded_source_type_intent_invalid' USING ERRCODE='22023'; END IF;
 IF c->>'intent_evidence_tier' IS NULL OR c->>'intent_evidence_tier' NOT IN('EXPLICIT_MESSAGE','EXPLICIT_SECTION','NONCONFLICTING_SOURCE_TYPE','CLEAR_ASKING_PRICE_INFERENCE') THEN
  RAISE EXCEPTION 'expanded_intent_tier_invalid' USING ERRCODE='22023'; END IF;
 IF f->>'original_price_amount' IS NOT NULL AND (coalesce(jsonb_array_length(e->'price'),0)<1
  OR f->>'original_price_amount' !~ '^[0-9]+([.][0-9]+)?$' OR (f->>'original_price_amount')::numeric<=0
  OR f->>'original_price_currency' IN('$','[NULL]')) THEN
  RAISE EXCEPTION 'expanded_original_price_evidence_invalid' USING ERRCODE='22023'; END IF;
 IF f->>'original_price_amount' IS NOT NULL THEN
  price_view=wf_canonical_staging.expanded_parsing_view_v3(e->'price'->0->>'quote');
  raw_number=(regexp_match(price_view,'[0-9][0-9.,]*'))[1];
  scale_token=(regexp_match(price_view,'(?:^|[0-9.,[:space:]])(million|mill|mil|mn|m|k)(?:$|[^a-z])','i'))[1];
  IF e->'price_numeric'->>'decimal_rule' IS DISTINCT FROM 'EXACT_SOURCE_DECIMAL_AND_EXPLICIT_SCALE_NO_ROUNDING'
   OR e->'price_numeric'->>'raw_number' IS DISTINCT FROM raw_number
   OR e->'price_numeric'->>'scale_token' IS DISTINCT FROM lower(scale_token) THEN
   RAISE EXCEPTION 'expanded_price_decimal_proof_invalid' USING ERRCODE='22023'; END IF;
  number_token=raw_number;
  IF number_token ~ '^[0-9]{1,3}(,[0-9]{3})+([.][0-9]{1,2})?$' AND scale_token IS NULL THEN number_token=replace(number_token,',','');
  ELSIF number_token ~ '^[0-9]{1,3}([.][0-9]{3})+$' AND scale_token IS NULL THEN number_token=replace(number_token,'.','');
  ELSIF number_token ~ '^[0-9]+[.,][0-9]+$' THEN number_token=replace(number_token,',','.'); END IF;
  IF number_token IS NULL OR number_token !~ '^[0-9]+([.][0-9]+)?$' THEN RAISE EXCEPTION 'expanded_price_decimal_format_invalid' USING ERRCODE='22023'; END IF;
  computed_amount=number_token::numeric*CASE WHEN scale_token IS NULL THEN 1 WHEN lower(scale_token)='k' THEN 1000 ELSE 1000000 END;
  IF computed_amount IS DISTINCT FROM (f->>'original_price_amount')::numeric
   OR computed_amount IS DISTINCT FROM (e->'price_numeric'->>'amount')::numeric THEN
   RAISE EXCEPTION 'expanded_price_amount_not_source_exact' USING ERRCODE='22023'; END IF;
 END IF;
 FOREACH field_name IN ARRAY ARRAY['condition','year','dial_color','model','country'] LOOP
  IF f->>field_name IS NOT NULL AND coalesce(jsonb_array_length(e->field_name),0)<1 THEN
   RAISE EXCEPTION 'expanded_optional_field_without_evidence' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF f->>'source_status' IS DISTINCT FROM r.raw_payload->>'status'
  OR c->'source_dates' IS DISTINCT FROM jsonb_build_object('created_on',r.raw_payload->'created_on','updated_on',r.raw_payload->'updated_on',
   'reposted_at',r.raw_payload->'reposted_at','deleted_on',r.raw_payload->'deleted_on') THEN
  RAISE EXCEPTION 'expanded_source_status_or_dates_changed' USING ERRCODE='22023'; END IF;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.verify_expanded_candidate_content_v3(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION wf_canonical_staging.stage_expanded_candidate_v3(p_raw_id uuid,p_policy_hash text,p_canonical text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; prior wf_canonical_staging.expanded_listing_candidates_v3; n integer;
BEGIN
 c=wf_canonical_staging.verify_expanded_candidate_content_v3(p_raw_id,p_policy_hash,p_canonical,p_hash);
 INSERT INTO wf_canonical_staging.expanded_listing_candidates_v3(candidate_hash,raw_row_id,source_hash,policy_hash,parent_source_field,parent_field_hash,kind,child_index,canonical_json)
 VALUES(p_hash,p_raw_id,c->>'source_hash',p_policy_hash,c->>'parent_source_field',c->>'parent_field_hash',c->>'kind',(c->>'child_index')::integer,p_canonical)
 ON CONFLICT(candidate_hash) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT * INTO STRICT prior FROM wf_canonical_staging.expanded_listing_candidates_v3 WHERE candidate_hash=p_hash;
 IF (prior.raw_row_id,prior.policy_hash,prior.canonical_json) IS DISTINCT FROM (p_raw_id,p_policy_hash,p_canonical) THEN
  RAISE EXCEPTION 'expanded_candidate_replay_changed' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('candidate_hash',p_hash,'inserted',n,'identical',1-n);
END $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.stage_expanded_candidate_v3(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE wf_canonical_staging.mariadb_canary_published_listings_v2
 ADD COLUMN source_listing_status text, ADD COLUMN source_deleted boolean,
 ADD COLUMN original_price_role text, ADD COLUMN source_created_at_text text;
NOTIFY pgrst,'reload schema';
COMMIT;
