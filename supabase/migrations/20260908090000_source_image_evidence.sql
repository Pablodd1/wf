-- Bounded source-image probe receipts. The reviewed service client performs the
-- HTTPS HEAD/GET; SQL binds that receipt to the exact immutable raw image key.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION wf_canonical_staging.source_image_candidate_v2(p_key text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE key text=btrim(p_key,E' \t\n\r\f\v'); bytes bytea; result text=''; n integer; b integer;
BEGIN
 IF key='' OR octet_length(key)>2048 OR position('..' in key)>0 OR position(chr(92) in key)>0
  OR position('?' in key)>0 OR position('#' in key)>0 THEN RETURN NULL; END IF;
 IF key LIKE 'listings/full/%' THEN key=substr(key,15);
 ELSIF key LIKE 'full/%' THEN key=substr(key,6);
 ELSIF key LIKE 'listings/%' THEN key=substr(key,10); END IF;
 key=ltrim(key,'/'); IF key='' THEN RETURN NULL; END IF;
 bytes=convert_to(key,'UTF8');
 FOR n IN 0..octet_length(bytes)-1 LOOP
  b=get_byte(bytes,n);
  IF (b BETWEEN 65 AND 90) OR (b BETWEEN 97 AND 122) OR (b BETWEEN 48 AND 57)
   OR position(chr(b) in ';,/?:@&=+$-_.!~*''()')>0 THEN result=result||chr(b);
  ELSE result=result||'%'||upper(lpad(to_hex(b),2,'0')); END IF;
 END LOOP;
 RETURN 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/'||result;
END; $$;
REVOKE ALL ON FUNCTION wf_canonical_staging.source_image_candidate_v2(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE wf_canonical_staging.source_image_evidence_v2 (
 evidence_hash text PRIMARY KEY CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 raw_row_id uuid NOT NULL REFERENCES wf_canonical_staging.mariadb_raw_source_rows(id),
 source_hash text NOT NULL, document jsonb NOT NULL, canonical_json text NOT NULL,
 verified boolean NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_image_evidence_v2_raw ON wf_canonical_staging.source_image_evidence_v2(raw_row_id,source_hash,recorded_at DESC);
ALTER TABLE wf_canonical_staging.source_image_evidence_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.source_image_evidence_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.stage_source_image_evidence_v2(p_document jsonb,p_canonical_json text,p_evidence_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r wf_canonical_staging.mariadb_raw_source_rows; existing wf_canonical_staging.source_image_evidence_v2;
 candidate text; key text; inserted integer; verified boolean;
BEGIN
 IF p_document IS NULL OR p_canonical_json IS NULL OR p_evidence_hash IS NULL OR octet_length(p_canonical_json)>16000
  OR p_evidence_hash !~ '^[a-f0-9]{64}$' OR p_canonical_json::jsonb IS DISTINCT FROM p_document
  OR encode(extensions.digest(convert_to(p_canonical_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_evidence_hash
  OR p_document->>'contract' IS DISTINCT FROM 'wf-source-image-evidence-v2' THEN
  RAISE EXCEPTION 'image_receipt_content_mismatch' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM wf_canonical_staging.mariadb_raw_source_rows WHERE id=(p_document->>'raw_row_id')::uuid FOR SHARE;
 IF NOT FOUND OR r.source_hash IS DISTINCT FROM p_document->>'source_hash' OR r.source_id IS DISTINCT FROM p_document->>'source_id'
  OR r.canonicalization_version IS DISTINCT FROM 'v1-json-keys-sorted-compact' OR r.hash_algorithm IS DISTINCT FROM 'sha256'
  OR r.raw_payload ? '_lossless_raw_evidence' OR r.raw_payload_text IS NULL
  OR r.raw_payload_text::jsonb IS DISTINCT FROM r.raw_payload
  OR encode(extensions.digest(convert_to(r.raw_payload_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM r.source_hash THEN
  RAISE EXCEPTION 'image_source_content_mismatch' USING ERRCODE='22023'; END IF;
 key=coalesce(nullif(r.raw_payload->>'front_image',''),r.raw_payload->>'image');
 candidate=wf_canonical_staging.source_image_candidate_v2(key);
 IF candidate IS NULL OR p_document->>'image_key' IS DISTINCT FROM key OR p_document->>'candidate_url' IS DISTINCT FROM candidate
  OR jsonb_typeof(p_document->'disposable') IS DISTINCT FROM 'boolean'
  OR p_document->>'checked_at' IS NULL OR (p_document->>'checked_at')::timestamptz>now()+interval '5 minutes'
  OR jsonb_typeof(p_document->'head_status') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_document->'get_status') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_document->'body_signature_verified') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_document->'body_prefix_bytes') IS DISTINCT FROM 'number'
  OR (p_document->>'body_prefix_bytes')::integer NOT BETWEEN 0 AND 4096 THEN
  RAISE EXCEPTION 'image_source_key_mismatch' USING ERRCODE='22023'; END IF;
 IF (p_document->>'disposable')::boolean THEN
  IF to_regnamespace('wf_disposable_legacy') IS NULL OR r.raw_payload->'synthetic_fixture' IS DISTINCT FROM 'true'::jsonb
   OR p_document->>'verified_url' IS NULL
   OR p_document->>'verified_url' !~ '^https://[a-z0-9-]+[.]trycloudflare[.]com/images/'
   OR regexp_replace(p_document->>'verified_url','^https://[a-z0-9-]+[.]trycloudflare[.]com/images','')
     IS DISTINCT FROM substr(candidate,length('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full')+1) THEN
   RAISE EXCEPTION 'disposable_image_origin_refused' USING ERRCODE='22023'; END IF;
 ELSIF p_document->>'verified_url' IS DISTINCT FROM candidate THEN
  RAISE EXCEPTION 'image_origin_mismatch' USING ERRCODE='22023'; END IF;
 verified=coalesce((p_document->>'head_status')::integer=200 AND (p_document->>'get_status')::integer IN(200,206)
  AND p_document->>'head_content_type' LIKE 'image/%' AND p_document->>'get_content_type' LIKE 'image/%'
  AND (p_document->>'body_signature_verified')::boolean AND (p_document->>'body_prefix_bytes')::integer>=3
  AND p_document->>'body_prefix_sha256' ~ '^[a-f0-9]{64}$',false);
 INSERT INTO wf_canonical_staging.source_image_evidence_v2(evidence_hash,raw_row_id,source_hash,document,canonical_json,verified)
 VALUES(p_evidence_hash,r.id,r.source_hash,p_document,p_canonical_json,verified) ON CONFLICT(evidence_hash) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO existing FROM wf_canonical_staging.source_image_evidence_v2 WHERE evidence_hash=p_evidence_hash;
 IF existing.document IS DISTINCT FROM p_document OR existing.canonical_json IS DISTINCT FROM p_canonical_json THEN
  RAISE EXCEPTION 'image_receipt_identity_conflict' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('evidence_hash',p_evidence_hash,'inserted',inserted,'identical',1-inserted,'verified',verified);
END; $$;
REVOKE ALL ON FUNCTION public.stage_source_image_evidence_v2(jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_source_image_evidence_v2(jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
