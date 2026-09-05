-- Preserve source-supplied values that exceed the legacy staging display
-- widths without altering columns used by existing public views.
--
-- The complete immutable raw message remains in raw_message_versions. This
-- trigger also copies any over-limit derived value into provenance_metadata
-- before creating the bounded presentation value required by the legacy
-- staging contract.

BEGIN;

CREATE OR REPLACE FUNCTION staging.preserve_source_field_overflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = staging, pg_catalog
AS $$
DECLARE
  v_overflow JSONB;
BEGIN
  v_overflow := jsonb_strip_nulls(jsonb_build_object(
    'brand_original', CASE WHEN length(NEW.brand_original) > 100 THEN NEW.brand_original END,
    'brand_normalized', CASE WHEN length(NEW.brand_normalized) > 100 THEN NEW.brand_normalized END,
    'model_original', CASE WHEN length(NEW.model_original) > 100 THEN NEW.model_original END,
    'model_normalized', CASE WHEN length(NEW.model_normalized) > 100 THEN NEW.model_normalized END,
    'reference_original', CASE WHEN length(NEW.reference_original) > 100 THEN NEW.reference_original END,
    'reference_normalized', CASE WHEN length(NEW.reference_normalized) > 100 THEN NEW.reference_normalized END,
    'dial_color_original', CASE WHEN length(NEW.dial_color_original) > 50 THEN NEW.dial_color_original END,
    'dial_color_normalized', CASE WHEN length(NEW.dial_color_normalized) > 50 THEN NEW.dial_color_normalized END,
    'condition_original', CASE WHEN length(NEW.condition_original) > 50 THEN NEW.condition_original END,
    'condition_normalized', CASE WHEN length(NEW.condition_normalized) > 50 THEN NEW.condition_normalized END,
    'user_name', CASE WHEN length(NEW.user_name) > 150 THEN NEW.user_name END,
    'from_name', CASE WHEN length(NEW.from_name) > 150 THEN NEW.from_name END,
    'location', CASE WHEN length(NEW.location) > 100 THEN NEW.location END
  ));

  IF v_overflow <> '{}'::jsonb THEN
    NEW.provenance_metadata := COALESCE(NEW.provenance_metadata, '{}'::jsonb)
      || jsonb_build_object('source_field_overflow', v_overflow);
  END IF;

  NEW.brand_original := left(NEW.brand_original, 100);
  NEW.brand_normalized := left(NEW.brand_normalized, 100);
  NEW.model_original := left(NEW.model_original, 100);
  NEW.model_normalized := left(NEW.model_normalized, 100);
  NEW.reference_original := left(NEW.reference_original, 100);
  NEW.reference_normalized := left(NEW.reference_normalized, 100);
  NEW.dial_color_original := left(NEW.dial_color_original, 50);
  NEW.dial_color_normalized := left(NEW.dial_color_normalized, 50);
  NEW.condition_original := left(NEW.condition_original, 50);
  NEW.condition_normalized := left(NEW.condition_normalized, 50);
  NEW.user_name := left(NEW.user_name, 150);
  NEW.from_name := left(NEW.from_name, 150);
  NEW.location := left(NEW.location, 100);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staging_preserve_source_field_overflow ON staging.listings;
CREATE TRIGGER trg_staging_preserve_source_field_overflow
BEFORE INSERT OR UPDATE ON staging.listings
FOR EACH ROW EXECUTE FUNCTION staging.preserve_source_field_overflow();

COMMIT;
