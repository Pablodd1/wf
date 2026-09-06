-- Private, immutable FX evidence. The reviewed capture client independently
-- recomputes every cross-rate from the retained ECB CSV before this RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.verified_fx_evidence_v2 (
 evidence_hash text PRIMARY KEY CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 document jsonb NOT NULL, canonical_json text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wf_canonical_staging.verified_fx_evidence_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.verified_fx_evidence_v2 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.stage_verified_fx_evidence_v2(p_document jsonb,p_canonical_json text,p_evidence_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing wf_canonical_staging.verified_fx_evidence_v2; pair record; inserted integer;
BEGIN
 IF p_document IS NULL OR p_canonical_json IS NULL OR p_evidence_hash IS NULL OR octet_length(p_canonical_json)>3000000
  OR p_evidence_hash !~ '^[a-f0-9]{64}$'
  OR p_canonical_json::jsonb IS DISTINCT FROM p_document
  OR encode(extensions.digest(convert_to(p_canonical_json,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_evidence_hash
  OR p_document->>'contract' IS DISTINCT FROM 'wf-verified-fx-evidence-v1'
  OR p_document->>'provider' IS DISTINCT FROM 'ECB'
  OR p_document->>'raw_csv' IS NULL
  OR encode(extensions.digest(convert_to(p_document->>'raw_csv','UTF8'),'sha256'),'hex') IS DISTINCT FROM p_document->>'raw_csv_sha256'
  OR p_document->>'request_url' !~ '^https://data-api[.]ecb[.]europa[.]eu/service/data/EXR/D[.][A-Z+]+[.]EUR[.]SP00[.]A[?]'
  OR p_document->>'request_url' IS NULL
  OR p_document->>'observed_date' IS NULL OR p_document->>'observed_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR p_document->>'fetched_at' IS NULL
  OR (p_document->>'fetched_at')::timestamptz<(p_document->>'observed_date')::date
  OR (p_document->>'fetched_at')::timestamptz>(p_document->>'observed_date')::date+interval '10 days'
  OR jsonb_typeof(p_document->'usd_per_unit') IS DISTINCT FROM 'object'
  OR p_document#>'{usd_per_unit,USD}' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION 'fx_evidence_content_mismatch' USING ERRCODE='22023';
 END IF;
 FOR pair IN SELECT key,value FROM jsonb_each(p_document->'usd_per_unit') LOOP
  IF pair.key NOT IN ('USD','EUR','HKD','GBP','CHF','CNY','JPY','SGD','KRW','THB','CAD','AUD','NZD','MYR','IDR','INR','PHP','BRL','MXN','ZAR','SEK','NOK','DKK')
   OR jsonb_typeof(pair.value) IS DISTINCT FROM 'number' OR pair.value::text::numeric<=0 THEN
   RAISE EXCEPTION 'fx_rate_unverified' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO wf_canonical_staging.verified_fx_evidence_v2(evidence_hash,document,canonical_json)
 VALUES(p_evidence_hash,p_document,p_canonical_json) ON CONFLICT(evidence_hash) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO existing FROM wf_canonical_staging.verified_fx_evidence_v2 WHERE evidence_hash=p_evidence_hash;
 IF existing.document IS DISTINCT FROM p_document OR existing.canonical_json IS DISTINCT FROM p_canonical_json THEN
  RAISE EXCEPTION 'fx_evidence_identity_conflict' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('evidence_hash',p_evidence_hash,'inserted',inserted,'identical',1-inserted,'observed_date',p_document->>'observed_date');
END;
$$;
REVOKE ALL ON FUNCTION public.stage_verified_fx_evidence_v2(jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_verified_fx_evidence_v2(jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
