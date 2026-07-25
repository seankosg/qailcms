
-- Phase 3: ABD Dashboard RPC 7종

-- 1) Row 1: 배타적 5분류 (total/Approved/UR/DS/NS) + 팀 브레이크다운
CREATE OR REPLACE FUNCTION public.abd_dashboard_row1(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
) RETURNS TABLE (bucket text, team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH base AS (
    SELECT COALESCE(bucket_top,'NS') AS bucket_top, team
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
  )
  SELECT bucket_top, NULL::text, count(*) FROM base GROUP BY bucket_top
  UNION ALL
  SELECT 'TOTAL', NULL, count(*) FROM base
  UNION ALL
  SELECT bucket_top, team, count(*) FROM base GROUP BY bucket_top, team;
$$;

-- 2) Row 2: 지연 카드 (RS/SB/DS 지연, No Plan) + 팀
CREATE OR REPLACE FUNCTION public.abd_dashboard_row2(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
) RETURNS TABLE (bucket text, team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH base AS (
    SELECT team, delay_bucket, needs_planning
    FROM abd_items_raw
    WHERE is_active AND NOT COALESCE(is_terminated,false)
      AND latest_status_norm IS DISTINCT FROM 'A'
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
  ), exploded AS (
    SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS b FROM base
    UNION ALL
    SELECT team, 'NO_PLAN'::text FROM base WHERE needs_planning
  )
  SELECT b, NULL::text, count(*) FROM exploded GROUP BY b
  UNION ALL
  SELECT 'TOTAL_DELAY', NULL, count(DISTINCT (team,b)) FROM exploded
  UNION ALL
  SELECT b, team, count(*) FROM exploded GROUP BY b, team;
$$;

-- 3) Status distribution
CREATE OR REPLACE FUNCTION public.abd_dashboard_status_dist(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
) RETURNS TABLE (status text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(latest_status_norm,'NS'), count(*)
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
  GROUP BY 1;
$$;

-- 4) Approval trend (월별)
CREATE OR REPLACE FUNCTION public.abd_dashboard_approval_trend(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL,
  _months int DEFAULT 12
) RETURNS TABLE (month_start date, team text, approved_cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT date_trunc('month', approval_date)::date AS ms, team, count(*)
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND latest_status_norm='A' AND approval_date IS NOT NULL
    AND approval_date >= (now() AT TIME ZONE 'Asia/Qatar')::date - (_months * INTERVAL '1 month')
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
  GROUP BY 1,2 ORDER BY 1;
$$;

-- 5) Overdue heatmap: team x delay_bucket
CREATE OR REPLACE FUNCTION public.abd_dashboard_overdue_heatmap(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
) RETURNS TABLE (team text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT team, unnest(COALESCE(delay_bucket,'{}'::text[])) AS b, count(*)::bigint
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
  GROUP BY team, b;
$$;

-- 6) Attention lists: needs_planning / ur_aging / status_mismatch
CREATE OR REPLACE FUNCTION public.abd_dashboard_attention_lists(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL,
  _limit int DEFAULT 20
) RETURNS TABLE (
  list_kind text, id uuid, team text, plot text, abd_number text,
  document_title text, current_stage text, ur_aging_days int,
  latest_status text, hdec_pic_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  (SELECT 'needs_planning'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false) AND needs_planning
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
   ORDER BY updated_at DESC LIMIT _limit)
  UNION ALL
  (SELECT 'ur_aging'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false)
     AND bucket_top='UR' AND ur_aging_days IS NOT NULL
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
   ORDER BY ur_aging_days DESC NULLS LAST LIMIT _limit)
  UNION ALL
  (SELECT 'status_mismatch'::text, id, team, plot, abd_number, document_title,
          current_stage, ur_aging_days, latest_status, hdec_pic_name
   FROM abd_items_raw
   WHERE is_active AND NOT COALESCE(is_terminated,false) AND status_mismatch
     AND (_plots IS NULL OR plot = ANY(_plots))
     AND (_teams IS NULL OR team = ANY(_teams))
   ORDER BY updated_at DESC LIMIT _limit);
$$;

-- 7) Crosscut: dis x service 분포
CREATE OR REPLACE FUNCTION public.abd_dashboard_crosscut(
  _plots text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL
) RETURNS TABLE (dis text, service text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(dis,'-'), COALESCE(service,'-'), COALESCE(bucket_top,'NS'), count(*)
  FROM abd_items_raw
  WHERE is_active AND NOT COALESCE(is_terminated,false)
    AND (_plots IS NULL OR plot = ANY(_plots))
    AND (_teams IS NULL OR team = ANY(_teams))
  GROUP BY 1,2,3;
$$;

GRANT EXECUTE ON FUNCTION public.abd_dashboard_row1(text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row2(text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_status_dist(text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_approval_trend(text[],text[],int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_overdue_heatmap(text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_attention_lists(text[],text[],int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_crosscut(text[],text[]) TO authenticated;
