CREATE OR REPLACE FUNCTION public.abd_dashboard_judgment_mix(
  _batch_no text[] DEFAULT NULL
)
RETURNS TABLE(
  stage text,
  total bigint,
  approved bigint,
  normal bigint,
  caution bigint,
  delayed bigint,
  critical bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warn int;
  v_late int;
BEGIN
  SELECT COALESCE(ur_aging_warn_days, 3), COALESCE(ur_aging_late_days, 7)
    INTO v_warn, v_late
  FROM public.abd_settings
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;
  v_warn := COALESCE(v_warn, 3);
  v_late := COALESCE(v_late, 7);

  RETURN QUERY
  WITH base AS (
    SELECT
      COALESCE(NULLIF(UPPER(r.current_stage), ''), 'NS') AS stg_raw,
      COALESCE(r.ur_aging_days, 0) AS aging
    FROM public.abd_items_raw r
    WHERE COALESCE(r.is_terminated, false) = false
      AND (_batch_no IS NULL OR r.batch_no = ANY(_batch_no))
  ),
  norm AS (
    SELECT
      CASE
        WHEN stg_raw IN ('APPROVED','A') THEN 'Approved'
        WHEN stg_raw = 'UR' THEN 'UR'
        WHEN stg_raw = 'DS' THEN 'DS'
        ELSE 'NS'
      END AS stage,
      CASE
        WHEN stg_raw IN ('APPROVED','A') THEN '완료'
        WHEN stg_raw = 'UR' AND aging >= v_late * 2 THEN '위험'
        WHEN stg_raw = 'UR' AND aging >= v_late THEN '지연'
        WHEN stg_raw = 'UR' AND aging >= v_warn THEN '주의'
        ELSE '정상'
      END AS jdg
    FROM base
  )
  SELECT
    s.stage,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE n.jdg = '완료')::bigint AS approved,
    COUNT(*) FILTER (WHERE n.jdg = '정상')::bigint AS normal,
    COUNT(*) FILTER (WHERE n.jdg = '주의')::bigint AS caution,
    COUNT(*) FILTER (WHERE n.jdg = '지연')::bigint AS delayed,
    COUNT(*) FILTER (WHERE n.jdg = '위험')::bigint AS critical
  FROM (VALUES ('NS'),('DS'),('UR'),('Approved')) AS s(stage)
  LEFT JOIN norm n ON n.stage = s.stage
  GROUP BY s.stage
  ORDER BY CASE s.stage WHEN 'NS' THEN 1 WHEN 'DS' THEN 2 WHEN 'UR' THEN 3 WHEN 'Approved' THEN 4 END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.abd_dashboard_judgment_mix(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_judgment_mix(text[]) TO service_role;