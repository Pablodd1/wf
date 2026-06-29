-- Migration: WTB & Bundle Detection Improvements
-- Phase 5 of 7-Phase Data Quality Plan
-- Improves NLP detection for WTB signals and bundle listings

-- 1. Enhanced WTB detection function
CREATE OR REPLACE FUNCTION detect_wtb(p_raw_message TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_lower TEXT;
    v_wtb_terms TEXT[] := ARRAY[
        'wtb', 'want to buy', 'wanting to buy',
        'looking for', 'lookin for', 'lookin 4',
        'iso ', 'in search of',
        'ntq', 'need to buy', 'need to find',
        'buying', 'searching for', 'search for',
        'lf ', 'l.f.', 'l f ',
        'wanted', 'wtbuy',
        'help me find', 'trying to find',
        'anyone selling', 'anyone has',
        'where can i buy', 'where to buy'
    ];
    v_selling_terms TEXT[] := ARRAY[
        'wts', 'want to sell', 'selling',
        'for sale', 'fs:', 'f/s',
        'price is', 'asking', 'obo',
        'trade', 'trading', 'up for grabs'
    ];
    v_has_wtb BOOLEAN := FALSE;
    v_has_sell BOOLEAN := FALSE;
    v_term TEXT;
BEGIN
    IF p_raw_message IS NULL OR length(trim(p_raw_message)) < 3 THEN
        RETURN FALSE;
    END IF;

    v_lower := lower(p_raw_message);

    -- Check WTB indicators
    FOREACH v_term IN ARRAY v_wtb_terms LOOP
        IF v_lower LIKE '%' || v_term || '%' THEN
            v_has_wtb := TRUE;
            EXIT;
        END IF;
    END LOOP;

    -- Check selling indicators (negative signal)
    FOREACH v_term IN ARRAY v_selling_terms LOOP
        IF v_lower LIKE '%' || v_term || '%' THEN
            v_has_sell := TRUE;
            EXIT;
        END IF;
    END LOOP;

    -- Logic:
    -- If has WTB terms and no selling terms → WTB
    -- If has both → ambiguous, return FALSE (let human decide)
    -- If has selling terms only → not WTB
    IF v_has_wtb AND NOT v_has_sell THEN
        RETURN TRUE;
    END IF;

    -- Secondary: no price + reference only = likely WTB
    IF NOT v_has_sell AND p_raw_message !~ '\$\d' AND p_raw_message !~ '\b\d{3,}[^\d]*(?:usd|eur|gbp|chf)' THEN
        -- Check if it contains only a reference number and brand-like words
        IF p_raw_message ~ '\b\d{5,6}\b' AND (
            v_lower ~ '\b(rolex|patek|ap|audemars|omega|cartier)'
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Enhanced bundle detection function
CREATE OR REPLACE FUNCTION detect_bundle(p_raw_message TEXT)
RETURNS TABLE (is_bundle BOOLEAN, ref_count INT, refs TEXT[]) AS $$
DECLARE
    v_refs TEXT[];
    v_unique_refs TEXT[];
BEGIN
    IF p_raw_message IS NULL THEN
        RETURN QUERY SELECT FALSE, 0::INT, ARRAY[]::TEXT[];
        RETURN;
    END IF;

    -- Extract all 5-6 digit reference numbers
    SELECT array_agg(DISTINCT m[1]) INTO v_unique_refs
    FROM regexp_matches(p_raw_message, '\b(\d{5,6})\b', 'g') AS m;

    IF v_unique_refs IS NULL THEN
        RETURN QUERY SELECT FALSE, 0::INT, ARRAY[]::TEXT[];
        RETURN;
    END IF;

    RETURN QUERY SELECT
        (array_length(v_unique_refs, 1) > 1),
        COALESCE(array_length(v_unique_refs, 1), 0),
        v_unique_refs;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Combined detection trigger (runs after validation trigger)
CREATE OR REPLACE FUNCTION detect_wtb_bundle()
RETURNS TRIGGER AS $$
DECLARE
    v_is_wtb BOOLEAN;
    v_bundle RECORD;
BEGIN
    -- Run WTB detection
    v_is_wtb := detect_wtb(NEW.raw_message);

    -- Run bundle detection
    SELECT * INTO v_bundle FROM detect_bundle(NEW.raw_message);

    -- Update record with detection results
    IF v_is_wtb THEN
        NEW.verdict := 'WTB';
        NEW.confidence := COALESCE(NEW.confidence, 75);
    END IF;

    -- Store bundle info in metadata JSONB if available
    IF NEW.metadata IS NULL THEN
        NEW.metadata := '{}'::JSONB;
    END IF;

    IF v_bundle.is_bundle THEN
        NEW.metadata := NEW.metadata || jsonb_build_object(
            'is_bundle', TRUE,
            'bundle_refs', v_bundle.refs,
            'bundle_count', v_bundle.ref_count
        );
        -- Lower confidence for bundles (need human review)
        IF NEW.confidence > 50 THEN
            NEW.confidence := GREATEST(NEW.confidence - 15, 30);
        END IF;
    ELSE
        NEW.metadata := NEW.metadata || jsonb_build_object('is_bundle', FALSE);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Drop and recreate trigger
DROP TRIGGER IF EXISTS trg_detect_wtb_bundle ON watch_records;

CREATE TRIGGER trg_detect_wtb_bundle
    BEFORE INSERT OR UPDATE ON watch_records
    FOR EACH ROW
    EXECUTE FUNCTION detect_wtb_bundle();

-- 5. Backfill: detect WTB in existing records
UPDATE watch_records
SET verdict = 'WTB',
    confidence = GREATEST(confidence, 75)
WHERE verdict != 'WTB'
  AND detect_wtb(raw_message)
  AND verdict NOT IN ('RECYCLE');

-- 6. Backfill: detect bundles in existing records
UPDATE watch_records
SET metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
    'is_bundle', TRUE,
    'bundle_refs', (SELECT array_agg(DISTINCT m[1]) FROM regexp_matches(raw_message, '\b(\d{5,6})\b', 'g') AS m),
    'bundle_count', (SELECT count(DISTINCT m[1]) FROM regexp_matches(raw_message, '\b(\d{5,6})\b', 'g') AS m)
)
WHERE raw_message ~ '.*\b\d{5,6}\b.*\b\d{5,6}\b.*'
  AND COALESCE(metadata->>'is_bundle', 'false') != 'true';

-- 7. Add comment
COMMENT ON FUNCTION detect_wtb IS 'Phase 5: Enhanced WTB detection with 25+ keywords and negative selling signals';
COMMENT ON FUNCTION detect_bundle IS 'Phase 5: Bundle detection via multi-reference extraction';
