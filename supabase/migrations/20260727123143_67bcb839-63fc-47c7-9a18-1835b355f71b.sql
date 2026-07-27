DROP FUNCTION IF EXISTS public.abd_dashboard_attention_lists(text[], text[], integer);
DROP FUNCTION IF EXISTS public.abd_dashboard_attention_lists(text[], text[], integer, text[]);

CREATE OR REPLACE FUNCTION public.abd_dashboard_attention_lists(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL,
  _limit integer DEFAULT 20,
  _batch_no text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH u AS (
    (SELECT 'needs_planning'::text AS list_kind, id, team, plot, abd_number, document_title,
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
     ORDER BY updated_at DESC LIMIT _limit)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(u)), '[]'::jsonb) FROM u;
$function$;

GRANT EXECUTE ON FUNCTION public.abd_dashboard_attention_lists(text[], text[], integer, text[]) TO authenticated, service_role;