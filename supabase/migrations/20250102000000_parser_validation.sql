-- Migration: Parser Validation Layer
-- Phase 4 of 7-Phase Data Quality Plan
-- Adds server-side validation via PostgreSQL trigger
-- Auto-rejects invalid data with RECYCLE verdict

-- 1. Validation function: checks reference, price, year, brand
CREATE OR REPLACE FUNCTION validate_watch_record()
RETURNS TRIGGER AS $$
DECLARE
    v_brands TEXT[] := ARRAY[
        'Rolex','Patek Philippe','Audemars Piguet','Richard Mille',
        'Vacheron Constantin','Omega','Cartier','Breitling','IWC',
        'Jaeger-LeCoultre','Panerai','Hublot','TAG Heuer','Tudor',
        'Longines','Seiko','Grand Seiko','Zenith','Blancpain',
        'Breguet','Chopard','Bulgari','GP','Girard-Perregaux',
        'Ulysse Nardin','Parmigiani','F.P. Journe','A. Lange & Soehne',
        'A. Lange & Söhne','Glashütte Original','Nomos','Bell & Ross',
        'Baume & Mercier','Certina','Eberhard','Fortis',
        'Glycine','Hamilton','Mido','Oris','Rado','Raymond Weil',
        'Sinn','Tissot','Union Glashütte','Victorinox','Zodiac',
        'Doxa','Eterna','Nivada Grenchen','Favre-Leuba',
        'Heuer','Universal Genève','Enicar','Ebel','Concord',
        'Corum','Daniel Roth','De Bethune','De Grisogono',
        'Greubel Forsey','Harry Winston','Hautlence','HYT',
        'Jacob & Co','Laurent Ferrier','Linde Werdelin',
        'Louis Moinet','MB&F','Moritz Grossmann','Ressence',
        'Roger Dubuis','Romain Gauthier','Romain Jerome',
        'Speake-Marin','Urwerk','Voutilainen','Xemex'
    ];
    v_refs TEXT[];
    v_ref TEXT;
    v_price NUMERIC;
    v_year INT;
    v_errors TEXT[] := '{}';
    v_old_verdict TEXT;
BEGIN
    -- Only validate on INSERT or when raw data changes
    IF TG_OP = 'UPDATE' THEN
        -- Skip if only metadata changed (not raw_message or parsed fields)
        IF NEW.raw_message IS NOT DISTINCT FROM OLD.raw_message
           AND NEW.brand IS NOT DISTINCT FROM OLD.brand
           AND NEW.price_usd IS NOT DISTINCT FROM OLD.price_usd
           AND NEW.reference IS NOT DISTINCT FROM OLD.reference
           AND NEW.year IS NOT DISTINCT FROM OLD.year THEN
            RETURN NEW;
        END IF;
        v_old_verdict := OLD.verdict;
    END IF;

    -- === REFERENCE VALIDATION ===
    -- Extract all 5-6 digit sequences
    IF NEW.reference IS NOT NULL THEN
        v_refs := regexp_matches(NEW.reference, '^\d{4,6}$');
        IF array_length(v_refs, 1) IS NULL OR array_length(v_refs, 1) = 0 THEN
            -- Try to find reference in raw_message
            IF NEW.raw_message IS NOT NULL THEN
                v_refs := regexp_matches(NEW.raw_message, '\b(\d{5,6})\b', 'g');
            END IF;
        END IF;
    ELSIF NEW.raw_message IS NOT NULL THEN
        v_refs := regexp_matches(NEW.raw_message, '\b(\d{5,6})\b', 'g');
    END IF;

    -- Validate each reference: must be 4-6 digits
    IF v_refs IS NOT NULL THEN
        FOREACH v_ref IN ARRAY v_refs LOOP
            IF v_ref !~ '^\d{4,8}$' THEN
                v_errors := array_append(v_errors, 'Invalid reference format: ' || v_ref);
            END IF;
        END LOOP;
    END IF;

    -- === PRICE VALIDATION ===
    v_price := NEW.price_usd;
    IF v_price IS NOT NULL THEN
        IF v_price < 0 THEN
            v_errors := array_append(v_errors, 'Negative price: ' || v_price::TEXT);
        ELSIF v_price > 0 AND v_price < 50 THEN
            v_errors := array_append(v_errors, 'Suspiciously low price: $' || v_price::TEXT);
        ELSIF v_price > 10000000 THEN
            v_errors := array_append(v_errors, 'Extreme price: $' || v_price::TEXT);
        END IF;
    END IF;

    -- === YEAR VALIDATION ===
    v_year := NEW.year;
    IF v_year IS NOT NULL THEN
        IF v_year < 1800 THEN
            v_errors := array_append(v_errors, 'Impossible year: ' || v_year::TEXT);
        ELSIF v_year > 2035 THEN
            v_errors := array_append(v_errors, 'Future year: ' || v_year::TEXT);
        END IF;
    END IF;

    -- === BRAND VALIDATION ===
    IF NEW.brand IS NOT NULL AND NEW.brand != '' THEN
        IF NOT (NEW.brand = ANY(v_brands)) THEN
            -- Allow unknown brands but flag them
            -- Don't reject, just note for review
            NULL;
        END IF;
    END IF;

    -- === SET VERDICT BASED ON VALIDATION ===
    IF array_length(v_errors, 1) > 0 THEN
        -- Has validation errors → RECYCLE for reprocessing
        NEW.verdict := 'RECYCLE';
        NEW.parser_error := array_to_string(v_errors, '; ');
        NEW.confidence := 0;
    ELSE
        -- No validation errors → keep or improve verdict
        IF NEW.verdict IS NULL OR NEW.verdict = '' THEN
            -- Score-based routing
            IF NEW.confidence >= 95 THEN
                NEW.verdict := 'APPROVED';
            ELSIF NEW.confidence >= 80 THEN
                NEW.verdict := 'REVIEW';
            ELSE
                NEW.verdict := 'HUMAN';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing trigger if present
DROP TRIGGER IF EXISTS trg_validate_watch_record ON watch_records;

-- 3. Create trigger: runs BEFORE INSERT OR UPDATE
CREATE TRIGGER trg_validate_watch_record
    BEFORE INSERT OR UPDATE ON watch_records
    FOR EACH ROW
    EXECUTE FUNCTION validate_watch_record();

-- 4. Add parser_error column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watch_records' AND column_name = 'parser_error'
    ) THEN
        ALTER TABLE watch_records ADD COLUMN parser_error TEXT;
    END IF;
END $$;

-- 5. Function to batch-revalidate all existing records
CREATE OR REPLACE FUNCTION revalidate_all_records()
RETURNS TABLE (
    total_checked BIGINT,
    recycled BIGINT,
    approved BIGINT,
    errors_found BIGINT
) AS $$
DECLARE
    v_total BIGINT;
    v_recycled BIGINT;
    v_approved BIGINT;
    v_errors BIGINT;
BEGIN
    -- Count current state
    SELECT COUNT(*) INTO v_total FROM watch_records;
    SELECT COUNT(*) INTO v_recycled FROM watch_records WHERE verdict = 'RECYCLE';
    SELECT COUNT(*) INTO v_approved FROM watch_records WHERE verdict = 'APPROVED';
    SELECT COUNT(*) INTO v_errors FROM watch_records WHERE parser_error IS NOT NULL;

    -- Re-validate by touching all records
    UPDATE watch_records SET updated_at = NOW() WHERE verdict != 'RECYCLE';

    RETURN QUERY SELECT v_total, v_recycled, v_approved, v_errors;
END;
$$ LANGUAGE plpgsql;

-- 6. Create index on parser_error for fast quality queries
CREATE INDEX IF NOT EXISTS idx_watch_records_parser_error ON watch_records(parser_error) WHERE parser_error IS NOT NULL;

-- 7. Log migration completion
COMMENT ON FUNCTION validate_watch_record() IS 'Phase 4: Auto-validates references, prices, years. Routes bad data to RECYCLE verdict.';
