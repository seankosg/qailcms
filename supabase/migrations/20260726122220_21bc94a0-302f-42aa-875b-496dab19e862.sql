
CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(
  _plots text[] DEFAULT NULL::text[],
  _teams text[] DEFAULT NULL::text[],
  _batch_no text[] DEFAULT NULL::text[]
)
RETURNS TABLE(bucket text, team text, cnt bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT team, delay_bucket, needs_planning
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND latest_status_norm IS DISTINCT FROM 'A'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), unn AS (
    SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS raw FROM base
  ), filtered AS (
    SELECT team,
      CASE raw
        WHEN 'RS' THEN 'RS_DELAY'
        WHEN 'SB' THEN 'SB_DELAY'
        WHEN 'DS' THEN 'DS_DELAY'
        WHEN 'NoPlan' THEN 'NO_PLAN'
        WHEN 'Revise' THEN 'REVISE'
      END AS b
    FROM unn
    WHERE raw IN ('RS','SB','DS','NoPlan','Revise')
  )
  SELECT b, NULL::text, count(*) FROM filtered GROUP BY b
  UNION ALL
  SELECT 'TOTAL_DELAY', NULL, count(*) FROM filtered
  UNION ALL
  SELECT b, team, count(*) FROM filtered GROUP BY b, team;
$function$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_attention_lists(
  _plots text[] DEFAULT NULL::text[],
  _teams text[] DEFAULT NULL::text[],
  _limit integer DEFAULT 20,
  _batch_no text[] DEFAULT NULL::text[]
)
RETURNS TABLE(list_kind text, id uuid, team text, plot text, abd_number text, document_title text, current_stage text, ur_aging_days integer, latest_status text, hdec_pic_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  (SELECT 'needs_planning'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false) AND needs_planning
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
     AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
   ORDER BY updated_at DESC LIMIT _limit)
  UNION ALL
  (SELECT 'needs_revise'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false) AND needs_revise
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
     AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
   ORDER BY updated_at DESC LIMIT _limit)
  UNION ALL
  (SELECT 'ur_aging'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false)
     AND bucket_top='UR' AND ur_aging_days IS NOT NULL
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
     AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
   ORDER BY ur_aging_days DESC NULLS LAST LIMIT _limit)
  UNION ALL
  (SELECT 'status_mismatch'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false)
     AND status_mismatch = true
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
     AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
   ORDER BY updated_at DESC LIMIT _limit);
$function$;
