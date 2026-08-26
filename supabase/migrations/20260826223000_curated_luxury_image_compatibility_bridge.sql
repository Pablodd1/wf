-- Exact compatibility bridge from the currently visible reviewed source to the
-- frozen Rolex/Patek shadow. This writes only immutable sidecar evidence.

ALTER TABLE public.curated_luxury_child_image_assets_shadow
  DROP CONSTRAINT IF EXISTS curated_luxury_child_image_assets_shadow_evidence_source_check;
ALTER TABLE public.curated_luxury_child_image_assets_shadow
  ADD CONSTRAINT curated_luxury_child_image_assets_shadow_evidence_source_check
  CHECK (evidence_source IN
    ('RAW_VERSION_CHILD_VERIFIED_MEDIA','NORMALIZED_EXACT_SOURCE_IMAGE',
     'STORED_SOURCE_URL','EXISTING_IMAGE_MANIFEST',
     'EXACT_PRODUCTION_LISTING_IDENTITY','DETERMINISTIC_SINGLE_WATCH'));

ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD COLUMN IF NOT EXISTS production_source_listing_id text,
  ADD COLUMN IF NOT EXISTS production_source_record_id text,
  ADD COLUMN IF NOT EXISTS raw_message_id uuid REFERENCES public.raw_messages(id),
  ADD COLUMN IF NOT EXISTS raw_version_id uuid REFERENCES public.raw_message_versions(id),
  ADD COLUMN IF NOT EXISTS compatibility_identity_sha256 text,
  ADD COLUMN IF NOT EXISTS association_method text,
  ADD COLUMN IF NOT EXISTS existing_production_visible boolean NOT NULL DEFAULT false;

ALTER TABLE public.curated_luxury_child_image_links_shadow
  DROP CONSTRAINT IF EXISTS curated_luxury_child_image_links_shadow_association_method_check;
ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD CONSTRAINT curated_luxury_child_image_links_shadow_association_method_check
  CHECK (association_method IS NULL OR association_method IN
    ('EXACT_PRODUCTION_LISTING_IDENTITY','DETERMINISTIC_SINGLE_WATCH'));
ALTER TABLE public.curated_luxury_child_image_links_shadow
  DROP CONSTRAINT IF EXISTS curated_luxury_child_image_links_shadow_compatibility_hash_check;
ALTER TABLE public.curated_luxury_child_image_links_shadow
  ADD CONSTRAINT curated_luxury_child_image_links_shadow_compatibility_hash_check
  CHECK (compatibility_identity_sha256 IS NULL OR compatibility_identity_sha256 ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS curated_luxury_child_image_links_production_idx
  ON public.curated_luxury_child_image_links_shadow
  (production_source_listing_id,source_image_key)
  WHERE existing_production_visible;

WITH production_images AS MATERIALIZED (
  SELECT i.id AS production_source_listing_id,i.source_record_id AS production_source_record_id,
    i.raw_message,btrim(i.user_image_url) AS source_url,
    i.source_payload_sha256 AS compatibility_identity_sha256,
    encode(extensions.digest(convert_to(btrim(i.user_image_url),'UTF8'),'sha256'),'hex') source_image_key
  FROM public.reviewed_workbook_inventory i
  WHERE coalesce(i.canonical_brand,i.supplied_brand,i.brand_scope) IN ('Rolex','Patek Philippe')
    AND coalesce(i.has_image,false)
    AND btrim(coalesce(i.user_image_url,'')) ~ '^https?://[^[:space:]]+$'
    AND upper(coalesce(i.verification_status,'')) NOT IN ('REJECTED','HIDDEN','DELETED','ARCHIVED')
    AND upper(coalesce(i.image_evidence_type,'')) = 'SELLER_LISTING_IMAGE'
    AND i.source_payload_sha256 ~ '^[0-9a-f]{64}$'
    AND i.source_payload_sha256 = encode(extensions.digest(convert_to(i.raw_message,'UTF8'),'sha256'),'hex')
), production_counts AS MATERIALIZED (
  SELECT compatibility_identity_sha256,count(*)::bigint production_count
  FROM production_images GROUP BY compatibility_identity_sha256
), shadow_candidates AS MATERIALIZED (
  SELECT c.run_id,c.current_listing_key,c.latest_raw_occurrence_key,c.parent_raw_text_sha256,
    c.exact_child_text_sha256,rv.id raw_version_id,rv.raw_message_id,
    coalesce(rv.raw_payload#>>'{raw_data,is_bundle}','false') raw_is_bundle,
    coalesce(rv.raw_text,rm.raw_text) immutable_raw_text
  FROM public.curated_luxury_current_listings_shadow c
  JOIN public.curated_luxury_raw_version_lineage_shadow vb ON vb.version_key=c.version_key
  JOIN public.raw_message_versions rv ON rv.id=vb.raw_version_id
  JOIN public.curated_luxury_raw_parent_lineage_shadow pb ON pb.parent_key=c.parent_key
  JOIN public.raw_messages rm ON rm.id=pb.raw_message_id AND rm.id=rv.raw_message_id
  WHERE c.run_id='17d6d831-86cd-5e67-9830-c881bcf16e0d'::uuid
    AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
    AND c.parent_raw_text_sha256 IN (SELECT compatibility_identity_sha256 FROM production_images)
), shadow_counts AS MATERIALIZED (
  SELECT parent_raw_text_sha256,count(*)::bigint shadow_count
  FROM shadow_candidates GROUP BY parent_raw_text_sha256
), exact_matches AS MATERIALIZED (
  SELECT s.*,p.production_source_listing_id,p.production_source_record_id,p.source_url,p.source_image_key,
    p.compatibility_identity_sha256
  FROM shadow_candidates s
  JOIN production_images p ON p.compatibility_identity_sha256=s.parent_raw_text_sha256
    AND p.raw_message=s.immutable_raw_text
  JOIN production_counts pc USING(compatibility_identity_sha256)
  JOIN shadow_counts sc ON sc.parent_raw_text_sha256=s.parent_raw_text_sha256
  WHERE pc.production_count=1 AND sc.shadow_count=1
    AND s.exact_child_text_sha256=s.parent_raw_text_sha256
    AND s.raw_is_bundle='false'
), inserted_assets AS (
  INSERT INTO public.curated_luxury_child_image_assets_shadow
    (source_image_key,source_url,source_asset_key,evidence_source,customer_safe)
  SELECT DISTINCT source_image_key,source_url,production_source_listing_id,
    'DETERMINISTIC_SINGLE_WATCH',true FROM exact_matches
  ON CONFLICT (source_image_key) DO NOTHING
  RETURNING source_image_key
)
INSERT INTO public.curated_luxury_child_image_links_shadow
  (run_id,current_listing_key,raw_occurrence_key,source_image_key,image_ordinal,
   production_source_listing_id,production_source_record_id,raw_message_id,raw_version_id,
   compatibility_identity_sha256,association_method,existing_production_visible)
SELECT run_id,current_listing_key,latest_raw_occurrence_key,source_image_key,0,
  production_source_listing_id,production_source_record_id,raw_message_id,raw_version_id,
  compatibility_identity_sha256,'DETERMINISTIC_SINGLE_WATCH',true
FROM exact_matches
ON CONFLICT (run_id,current_listing_key,source_image_key) DO NOTHING;

NOTIFY pgrst,'reload schema';
