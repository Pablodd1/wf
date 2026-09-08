-- Hold complete currency/amount tokens without changing raw proposals or
-- previously reviewed identity evidence. Source-exact corrected references
-- still use the original identity proof and immutable reviewer sidecar.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE definition text;needle text;replacement text;
 codes text='(HKD|HDK|USD|USDT|EUR|GBP|AED|CHF|SGD|JPY|CNY|RMB|AUD|CAD|NZD|INR|THB|MYR|KRW|TWD|SAR|QAR|KWD|BHD|ZAR|BRL|MXN|PHP|IDR|VND|TRY|DKK|NOK|SEK)';
 pattern text;
BEGIN
 pattern='^('||codes||'[[:space:]:.$-]*[0-9][0-9.,]*([[:space:]]*[KM])?|[0-9][0-9.,]*([[:space:]]*[KM])?[[:space:]:.$-]*'||codes||')$';
 definition=replace(pg_get_functiondef('wf_canonical_staging.resolve_reviewed_source_identity_v2(uuid,text)'::regprocedure),chr(13),'');
 needle=E' IF NOT FOUND THEN\n  IF p.proposal_document->>''reference'' ~ ''^(19|20)[0-9]{2}[-/]([0-9]{2}|(19|20)[0-9]{2})$'' THEN';
 replacement=E' IF NOT FOUND THEN\n  IF btrim(p.proposal_document->>''reference'') ~* '||quote_literal(pattern)||E' THEN\n   RETURN proof||jsonb_build_object(''outcome'',''REVIEW'',''reasons'',(proof->''reasons'')||''"REFERENCE_IS_CURRENCY_AMOUNT"''::jsonb);\n  END IF;\n  IF p.proposal_document->>''reference'' ~ ''^(19|20)[0-9]{2}[-/]([0-9]{2}|(19|20)[0-9]{2})$'' THEN';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'currency_reference_unreviewed_guard_definition_mismatch'; END IF;
 definition=replace(definition,needle,replacement);
 needle=E'   OR ref ~ ''^(19|20)[0-9]{2}$''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'currency_reference_reviewed_guard_definition_mismatch'; END IF;
 definition=replace(definition,needle,needle||E'\n   OR btrim(ref) ~* '||quote_literal(pattern));
 EXECUTE definition;
END $guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
