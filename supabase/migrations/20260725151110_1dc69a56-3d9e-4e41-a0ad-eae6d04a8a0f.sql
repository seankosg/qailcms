
CREATE OR REPLACE FUNCTION public.abd_dashboard_row1(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(bucket text, team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH base AS (
    SELECT COALESCE(bucket_top,'NS') AS bucket_top, team
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  )
  SELECT bucket_top, NULL::text, count(*) FROM base GROUP BY bucket_top
  UNION ALL SELECT 'TOTAL', NULL, count(*) FROM base
  UNION ALL SELECT bucket_top, team, count(*) FROM base GROUP BY bucket_top, team;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(bucket text, team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH base AS (
    SELECT team, delay_bucket, needs_planning
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND latest_status_norm IS DISTINCT FROM 'A'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), exploded AS (
    SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS b FROM base
    UNION ALL SELECT team, 'NO_PLAN'::text FROM base WHERE needs_planning
  )
  SELECT b, NULL::text, count(*) FROM exploded GROUP BY b
  UNION ALL SELECT 'TOTAL_DELAY', NULL, count(DISTINCT (team,b)) FROM exploded
  UNION ALL SELECT b, team, count(*) FROM exploded GROUP BY b, team;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_status_dist(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(status text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT COALESCE(latest_status_norm,'NS'), count(*)
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
    AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_approval_trend(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _months integer DEFAULT 12, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(month_start date, team text, approved_cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT date_trunc('month', approval_date)::date AS ms, team, count(*)
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND latest_status_norm='A' AND approval_date IS NOT NULL
    AND approval_date >= (now() AT TIME ZONE 'Asia/Qatar')::date - (_months * INTERVAL '1 month')
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
    AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  GROUP BY 1,2 ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_overdue_heatmap(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(team text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS b, count(*)::bigint
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
    AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  GROUP BY team, b;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_attention_lists(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _limit integer DEFAULT 20, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(list_kind text, id uuid, team text, plot text, abd_number text, document_title text, current_stage text, ur_aging_days integer, latest_status text, hdec_pic_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  (SELECT 'needs_planning'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false) AND needs_planning
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
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_crosscut(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL, _batch_no text[] DEFAULT NULL
) RETURNS TABLE(dis text, service text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH base AS (
    SELECT dis, service, latest_status_norm, delay_bucket
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  )
  SELECT dis, service, 'TOTAL'::text, count(*) FROM base GROUP BY dis, service
  UNION ALL
  SELECT dis, service, 'APPROVED'::text, count(*) FROM base WHERE latest_status_norm='A' GROUP BY dis, service
  UNION ALL
  SELECT dis, service, 'DELAYED'::text, count(*) FROM base WHERE COALESCE(array_length(delay_bucket,1),0) > 0 GROUP BY dis, service;
$$;

GRANT EXECUTE ON FUNCTION public.abd_dashboard_row1(text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row2(text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_status_dist(text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_approval_trend(text[],text[],integer,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_overdue_heatmap(text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_attention_lists(text[],text[],integer,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_crosscut(text[],text[],text[]) TO authenticated;
