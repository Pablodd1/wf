-- Display ordering may recognize source price syntax without promoting that
-- syntax into verified analytics. The underlying ordered function retains all
-- currency/provenance flags; this wrapper only determines customer card order.

BEGIN;

CREATE OR REPLACE FUNCTION public.qnsa_zenith_display_ordered_page(
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50,
  p_listing_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,staging,pg_catalog
AS $$
  WITH all_rows AS MATERIALIZED (
    SELECT DISTINCT ON (row_data->>'id') row_data
    FROM generate_series(0,450,50) page_offset
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements(
        public.qnsa_zenith_ordered_candidate_page(page_offset,50,p_listing_type)->'rows'
      ) row_data
    ) page
    ORDER BY row_data->>'id'
  ), classified AS MATERIALIZED (
    SELECT row_data,
      COALESCE((row_data->>'has_exact_source_image')::boolean,false) AS has_image,
      (
        CASE WHEN COALESCE(row_data->>'source_price_amount','') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (row_data->>'source_price_amount')::numeric>0 ELSE false END
        OR CASE WHEN COALESCE(row_data->>'workbook_price_usd','') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (row_data->>'workbook_price_usd')::numeric>0 ELSE false END
        OR COALESCE(row_data->>'raw_message','') ~* (
          '([$€£][[:space:]]*[0-9][0-9.,]*([[:space:]]*[kKmM])?)|'
          '([0-9][0-9.,]*([[:space:]]*[kKmM])?[[:space:]]*(USD|USDT|EUR|HKD|HKN|HNK|GBP|CHF|SGD|CNY|RMB|JPY))|'
          '((USD|USDT|EUR|HKD|HKN|HNK|GBP|CHF|SGD|CNY|RMB|JPY)[[:space:]]*[0-9][0-9.,]*)'
        )
      ) AS has_source_price_signal
    FROM all_rows
  ), page_rows AS MATERIALIZED (
    SELECT jsonb_set(row_data,'{source_price_signal}',to_jsonb(has_source_price_signal),true) row_data,
      has_image,has_source_price_signal,row_data->>'normalized_reference' sort_reference,row_data->>'id' sort_id
    FROM classified
    ORDER BY has_image DESC,has_source_price_signal DESC,sort_reference ASC,sort_id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),50)+1
    OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT jsonb_build_object(
    'rows',COALESCE((SELECT jsonb_agg(row_data ORDER BY has_image DESC,has_source_price_signal DESC,sort_reference,sort_id)
      FROM (SELECT * FROM page_rows LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),50)) selected),'[]'::jsonb),
    'next_offset',GREATEST(COALESCE(p_offset,0),0)+LEAST((SELECT count(*) FROM page_rows),LEAST(GREATEST(COALESCE(p_limit,50),1),50)),
    'has_more',(SELECT count(*) FROM page_rows)>LEAST(GREATEST(COALESCE(p_limit,50),1),50),
    'scanned_count',(SELECT count(*) FROM page_rows),
    'eligible_count',LEAST((SELECT count(*) FROM page_rows),LEAST(GREATEST(COALESCE(p_limit,50),1),50))
  );
$$;

REVOKE ALL ON FUNCTION public.qnsa_zenith_display_ordered_page(INTEGER,INTEGER,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_zenith_display_ordered_page(INTEGER,INTEGER,TEXT)
  TO service_role,postgres,supabase_admin;

CREATE OR REPLACE FUNCTION public.qnsa_later_brand_candidate_stride_page(
  p_brand TEXT,p_offset INTEGER DEFAULT 0,p_limit INTEGER DEFAULT 50,p_listing_type TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,staging,pg_catalog AS $$
  SELECT CASE WHEN p_brand='Zenith' THEN public.qnsa_zenith_display_ordered_page(
    GREATEST(COALESCE(p_offset,0),0),LEAST(GREATEST(COALESCE(p_limit,50),1),50),p_listing_type)
  ELSE public.qnsa_later_brand_candidate_page(p_brand,GREATEST(COALESCE(p_offset,0),0),
    LEAST(GREATEST(COALESCE(p_limit,50),1),50),CASE WHEN p_brand='Richard Mille' THEN 4 ELSE 50 END,p_listing_type) END;
$$;

REVOKE ALL ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT,INTEGER,INTEGER,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qnsa_later_brand_candidate_stride_page(TEXT,INTEGER,INTEGER,TEXT)
  TO service_role,postgres,supabase_admin;
NOTIFY pgrst,'reload schema';

COMMIT;
