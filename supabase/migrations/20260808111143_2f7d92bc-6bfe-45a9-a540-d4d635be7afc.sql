-- 실적이 바뀌면(임포트·수동 편집 무관) 추정 표시를 해제한다. 추정치가 실측을 덮는 경로는 없다.
CREATE OR REPLACE FUNCTION public.bf_clear_estimated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.actual_start IS DISTINCT FROM OLD.actual_start
     OR NEW.actual_finish IS DISTINCT FROM OLD.actual_finish THEN
    NEW.actual_estimated := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wrt_clear_estimated ON public.wrt_stage_progress;
CREATE TRIGGER trg_wrt_clear_estimated BEFORE UPDATE ON public.wrt_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.bf_clear_estimated();

DROP TRIGGER IF EXISTS trg_spl_clear_estimated ON public.spl_stage_progress;
CREATE TRIGGER trg_spl_clear_estimated BEFORE UPDATE ON public.spl_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.bf_clear_estimated();

CREATE OR REPLACE FUNCTION public.wrt_estimated_cells()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT p.item_id, p.stage_code,
           jsonb_strip_nulls(jsonb_build_object(
             'as', CASE WHEN p.actual_start  IS NOT NULL THEN true END,
             'af', CASE WHEN p.actual_finish IS NOT NULL THEN true END)) AS v
    FROM public.wrt_stage_progress p
    JOIN public.wrt_items i ON i.id = p.item_id AND i.is_active
    WHERE p.actual_estimated
      AND (p.actual_start IS NOT NULL OR p.actual_finish IS NOT NULL)
  ), m AS (
    SELECT item_id, jsonb_object_agg(stage_code, v) AS sm FROM s GROUP BY item_id
  )
  SELECT jsonb_build_object(
    'items', (SELECT count(*) FROM m),
    'map', coalesce((SELECT jsonb_object_agg(item_id::text, sm) FROM m), '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.spl_estimated_cells()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT p.item_id, p.stage_code,
           jsonb_strip_nulls(jsonb_build_object(
             'as', CASE WHEN p.actual_start  IS NOT NULL THEN true END,
             'af', CASE WHEN p.actual_finish IS NOT NULL THEN true END)) AS v
    FROM public.spl_stage_progress p
    JOIN public.spl_items i ON i.id = p.item_id
    WHERE p.actual_estimated
      AND (p.actual_start IS NOT NULL OR p.actual_finish IS NOT NULL)
  ), m AS (
    SELECT item_id, jsonb_object_agg(stage_code, v) AS sm FROM s GROUP BY item_id
  )
  SELECT jsonb_build_object(
    'items', (SELECT count(*) FROM m),
    'map', coalesce((SELECT jsonb_object_agg(item_id::text, sm) FROM m), '{}'::jsonb));
$$;

GRANT EXECUTE ON FUNCTION public.wrt_estimated_cells() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spl_estimated_cells() TO authenticated;