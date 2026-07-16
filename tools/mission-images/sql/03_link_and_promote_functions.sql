CREATE OR REPLACE FUNCTION public.mission_images_link_batch(p_limit INTEGER DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed INTEGER := 0;
  v_linked INTEGER := 0;
  v_no_match INTEGER := 0;
  v_ambiguous INTEGER := 0;
BEGIN
  CREATE TEMP TABLE mission_images_batch ON COMMIT DROP AS
  SELECT bucket, object_key, extracted_id
  FROM public.media_object_inventory
  WHERE mapping_status = 'PENDING'
    AND namespace = 'listings'
    AND media_kind = 'image'
    AND extracted_id IS NOT NULL
  ORDER BY object_key
  LIMIT LEAST(GREATEST(p_limit, 1), 5000)
  FOR UPDATE SKIP LOCKED;

  GET DIAGNOSTICS v_processed = ROW_COUNT;
  IF v_processed = 0 THEN
    RETURN jsonb_build_object('processed', 0, 'linked', 0, 'no_match', 0, 'ambiguous', 0);
  END IF;

  CREATE TEMP TABLE mission_images_matches ON COMMIT DROP AS
  SELECT b.bucket, b.object_key, min(w.id) AS source_record_id, count(*) AS match_count
  FROM mission_images_batch b
  JOIN public.watch_records w
    ON substring(lower(w.flags ->> 'image') from '([0-9a-f]{13,24}|[0-9]{1,12})') = b.extracted_id
  GROUP BY b.bucket, b.object_key;

  UPDATE public.media_object_inventory media
  SET source_record_id = matches.source_record_id,
      mapping_status = 'LINKED',
      mapping_method = 'watch_records.flags.image',
      mapped_at = now(),
      updated_at = now()
  FROM mission_images_matches matches
  WHERE media.bucket = matches.bucket
    AND media.object_key = matches.object_key
    AND matches.match_count = 1;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  UPDATE public.media_object_inventory media
  SET mapping_status = 'AMBIGUOUS', mapped_at = now(), updated_at = now()
  FROM mission_images_matches matches
  WHERE media.bucket = matches.bucket
    AND media.object_key = matches.object_key
    AND matches.match_count > 1;
  GET DIAGNOSTICS v_ambiguous = ROW_COUNT;

  UPDATE public.media_object_inventory media
  SET mapping_status = 'NO_MATCH', mapped_at = now(), updated_at = now()
  FROM mission_images_batch batch
  WHERE media.bucket = batch.bucket
    AND media.object_key = batch.object_key
    AND NOT EXISTS (
      SELECT 1 FROM mission_images_matches matches
      WHERE matches.bucket = batch.bucket AND matches.object_key = batch.object_key
    );
  GET DIAGNOSTICS v_no_match = ROW_COUNT;

  RETURN jsonb_build_object(
    'processed', v_processed, 'linked', v_linked,
    'no_match', v_no_match, 'ambiguous', v_ambiguous
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mission_images_promote_batch(p_limit INTEGER DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed INTEGER := 0;
  v_promoted_objects INTEGER := 0;
BEGIN
  CREATE TEMP TABLE mission_images_records ON COMMIT DROP AS
  SELECT DISTINCT source_record_id
  FROM public.media_object_inventory
  WHERE mapping_status = 'LINKED' AND source_record_id IS NOT NULL
  ORDER BY source_record_id
  LIMIT LEAST(GREATEST(p_limit, 1), 5000);
  GET DIAGNOSTICS v_processed = ROW_COUNT;

  UPDATE public.watch_records watch
  SET image_urls = combined.urls,
      thumbnail_url = COALESCE(watch.thumbnail_url, combined.thumbnail),
      has_images = TRUE
  FROM (
    SELECT records.source_record_id,
      jsonb_agg(url ORDER BY url) AS urls,
      min(url) AS thumbnail
    FROM mission_images_records records
    CROSS JOIN LATERAL (
      SELECT DISTINCT value AS url
      FROM jsonb_array_elements_text(COALESCE(
        (SELECT image_urls FROM public.watch_records WHERE id = records.source_record_id),
        '[]'::jsonb
      )) existing(value)
      UNION
      SELECT inventory.public_url
      FROM public.media_object_inventory inventory
      WHERE inventory.source_record_id = records.source_record_id
        AND inventory.mapping_status = 'LINKED'
        AND inventory.media_kind = 'image'
    ) all_urls
    GROUP BY records.source_record_id
  ) combined
  WHERE watch.id = combined.source_record_id;

  UPDATE public.media_object_inventory inventory
  SET mapping_status = 'PROMOTED', promoted_at = now(), updated_at = now()
  FROM mission_images_records records
  WHERE inventory.source_record_id = records.source_record_id
    AND inventory.mapping_status = 'LINKED';
  GET DIAGNOSTICS v_promoted_objects = ROW_COUNT;

  RETURN jsonb_build_object('processed', v_processed, 'promoted_objects', v_promoted_objects);
END;
$$;

REVOKE ALL ON FUNCTION public.mission_images_link_batch(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mission_images_promote_batch(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mission_images_link_batch(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mission_images_promote_batch(INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
