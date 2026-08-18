-- Forward-only storage correction for immutable MariaDB raw evidence.
--
-- public.raw_message_versions remains the authoritative, byte-complete JSONB
-- evidence store. public.raw_messages is an identity envelope and retains only
-- compact lineage metadata for MariaDB rows. Existing full envelope payloads
-- are compacted only after proving an exact immutable version exists.

BEGIN;

CREATE OR REPLACE FUNCTION public.compact_mariadb_raw_envelope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.source_platform = 'mariadb' AND NEW.raw_payload IS NOT NULL THEN
    NEW.raw_payload := jsonb_strip_nulls(jsonb_build_object(
      'contract', NEW.raw_payload->>'contract',
      'source_record_id', NEW.raw_payload->>'source_record_id',
      'raw_sha256', NEW.raw_payload->>'raw_sha256',
      'raw_message_source', NEW.raw_payload->>'raw_message_source'
    ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compact_mariadb_raw_envelope ON public.raw_messages;
CREATE TRIGGER trg_compact_mariadb_raw_envelope
BEFORE INSERT OR UPDATE OF raw_payload ON public.raw_messages
FOR EACH ROW
EXECUTE FUNCTION public.compact_mariadb_raw_envelope();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.raw_messages AS envelope
    WHERE envelope.source_platform = 'mariadb'
      AND envelope.raw_payload ? 'raw_data'
      AND NOT EXISTS (
        SELECT 1
        FROM public.raw_message_versions AS version
        WHERE version.raw_message_id = envelope.id
          AND version.raw_payload = envelope.raw_payload
      )
  ) THEN
    RAISE EXCEPTION 'refusing to compact a MariaDB envelope without an exact immutable version';
  END IF;

  UPDATE public.raw_messages AS envelope
  SET raw_payload = jsonb_strip_nulls(jsonb_build_object(
    'contract', envelope.raw_payload->>'contract',
    'source_record_id', envelope.raw_payload->>'source_record_id',
    'raw_sha256', envelope.raw_payload->>'raw_sha256',
    'raw_message_source', envelope.raw_payload->>'raw_message_source'
  ))
  WHERE envelope.source_platform = 'mariadb'
    AND envelope.raw_payload ? 'raw_data';
END;
$$;

REVOKE ALL ON FUNCTION public.compact_mariadb_raw_envelope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compact_mariadb_raw_envelope() TO service_role;

COMMENT ON FUNCTION public.compact_mariadb_raw_envelope() IS
  'Keeps MariaDB identity envelopes compact while byte-complete source evidence remains immutable in raw_message_versions.';

COMMIT;
