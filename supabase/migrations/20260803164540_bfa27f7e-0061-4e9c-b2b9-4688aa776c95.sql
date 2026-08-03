-- 1) 버킷 정본 (잔여 정의)
CREATE OR REPLACE FUNCTION public.abd_bucket_of(_bucket_top text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _bucket_top = 'Approved' THEN 'Approved'
    WHEN _bucket_top = 'UR' THEN 'UR'
    WHEN _bucket_top = 'DS' THEN 'DS'
    ELSE 'RESUBMIT'
  END
$$;

-- 2) abd_judge_v1: v_past 분기 bucket_top 을 NO_HISTORY -> RESUBMIT (조건 불변)
DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname = 'abd_judge_v1' AND pronamespace = 'public'::regnamespace;
  d := replace(d, $r$'bucket_top', 'NO_HISTORY'$r$, $r$'bucket_top', 'RESUBMIT'$r$);
  EXECUTE d;
END $do$;

-- 3) abd_items_search: _excluded_mode 폐지 + 버킷 정본 참조 + resubmit/다중 status_group
DO $do$
DECLARE d text; old_blk text; new_sg text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname = 'abd_items_search' AND pronamespace = 'public'::regnamespace;

  d := replace(d, $r$_excluded_mode text DEFAULT 'hide'::text, $r$, '');

  old_blk := $r$  IF _excluded_mode = 'only' THEN
    _where := _where || ' and coalesce(is_terminated, false) = true';
  ELSIF _excluded_mode = 'all' THEN
    NULL;
  ELSE
    _where := _where || ' and coalesce(is_terminated, false) = false';
  END IF;
$r$;
  IF position(old_blk in d) = 0 THEN
    RAISE EXCEPTION 'abd_items_search: excluded_mode block not found';
  END IF;
  d := replace(d, old_blk, '');

  d := replace(d, $r$coalesce(bucket_top,''DS'')$r$, $r$public.abd_bucket_of(bucket_top)$r$);
  d := replace(d, $r$coalesce(bucket_top,'''')$r$, $r$public.abd_bucket_of(bucket_top)$r$);

  d := replace(d, $r$  ELSIF _sg = 'drafting' THEN$r$,
$r$  ELSIF _sg = 'resubmit' THEN
    _where := _where || ' and public.abd_bucket_of(bucket_top) = ''RESUBMIT''';
  ELSIF _sg = 'drafting' THEN$r$);

  new_sg := $r$    IF _col = 'status_group' THEN
      IF _op = 'in' AND jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        SELECT array_agg(b) INTO _cols FROM (
          SELECT CASE x
                   WHEN 'approved' THEN 'Approved'
                   WHEN 'under_review' THEN 'UR'
                   WHEN 'drafting' THEN 'DS'
                   WHEN 'resubmit' THEN 'RESUBMIT'
                 END AS b
          FROM jsonb_array_elements_text(_val) AS x
        ) s WHERE b IS NOT NULL;
        IF _cols IS NOT NULL AND array_length(_cols,1) > 0 THEN
          _where := _where || format(' and public.abd_bucket_of(bucket_top) = any(%L::text[])', _cols);
        END IF;
      END IF;
      CONTINUE;
    END IF;$r$;
  d := replace(d, $r$    IF _col = 'status_group' THEN CONTINUE; END IF;$r$, new_sg);

  DROP FUNCTION IF EXISTS public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text, text[], date);
  EXECUTE d;
END $do$;

-- 4) abd_items_counts: 5분할 재작성 (excluded_count 폐기)
DROP FUNCTION IF EXISTS public.abd_items_counts(text, boolean, text, date);
CREATE OR REPLACE FUNCTION public.abd_items_counts(
  _team text DEFAULT NULL, _include_inactive boolean DEFAULT false,
  _plot text DEFAULT NULL, _as_of date DEFAULT NULL)
RETURNS TABLE(total_count bigint, approved_count bigint, ur_count bigint,
              ds_count bigint, resubmit_count bigint, latest_data_date text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top) = 'Approved')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top) = 'UR')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top) = 'DS')::bigint,
    count(*) FILTER (WHERE public.abd_bucket_of(bucket_top) = 'RESUBMIT')::bigint,
    max(data_date)::text
  FROM public.abd_rows_as_of(_as_of)
  WHERE (_team IS NULL OR _team = '' OR team = ANY(string_to_array(_team, ',')))
    AND (_plot IS NULL OR plot = _plot)
    AND (_include_inactive OR is_active = true);
$$;

-- 5) Row1: 버킷 정본 + TOTAL 팀별 breakdown 서버 산출
CREATE OR REPLACE FUNCTION public.abd_dashboard_row1_json(
  _plots text[] DEFAULT NULL, _teams text[] DEFAULT NULL,
  _batch_no text[] DEFAULT NULL, _as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT public.abd_bucket_of(bucket_top) AS bucket_top, team
    FROM public.abd_rows_as_of(_as_of)
    WHERE is_active
      AND (_plots IS NULL OR plot = ANY(_plots))
      AND (_teams IS NULL OR team = ANY(_teams))
      AND (_batch_no IS NULL OR batch_no = ANY(_batch_no))
  ), agg AS (
    SELECT bucket_top AS bucket, NULL::text AS team, count(*) AS cnt FROM base GROUP BY bucket_top
    UNION ALL SELECT 'TOTAL', NULL, count(*) FROM base
    UNION ALL SELECT bucket_top, team, count(*) FROM base GROUP BY bucket_top, team
    UNION ALL SELECT 'TOTAL', team, count(*) FROM base GROUP BY team
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg;
$$;

-- 6) 팀 탭 전용 무필터 distinct
CREATE OR REPLACE FUNCTION public.abd_team_list()
RETURNS TABLE(team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT team, count(*)::bigint
  FROM public.abd_items_raw
  WHERE is_active AND team IS NOT NULL AND btrim(team) <> ''
  GROUP BY team
  ORDER BY team;
$$;

GRANT EXECUTE ON FUNCTION public.abd_bucket_of(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.abd_team_list() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_items_counts(text, boolean, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_items_search(text, text, boolean, text, jsonb, jsonb, integer, integer, text, text[], date) TO authenticated, service_role;