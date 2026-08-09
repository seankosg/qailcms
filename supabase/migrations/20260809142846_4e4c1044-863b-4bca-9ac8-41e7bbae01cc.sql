-- 1) 6단계 확장용 컬럼 추가
ALTER TABLE public.defect_items_raw
  ADD COLUMN IF NOT EXISTS planned_pre_inspection_date  date,
  ADD COLUMN IF NOT EXISTS actual_pre_inspection_date   date,
  ADD COLUMN IF NOT EXISTS planned_dar_inspection_date  date,
  ADD COLUMN IF NOT EXISTS actual_dar_inspection_date   date,
  ADD COLUMN IF NOT EXISTS planned_ho_date              date,
  ADD COLUMN IF NOT EXISTS actual_ho_date               date;

-- 2) 스테이지 판정 함수 3종 교체 ('completion' alias 제거)
CREATE OR REPLACE FUNCTION public._snag_stage_planned_date(_row defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE _stage
    WHEN 'start'          THEN _row.planned_start_date
    WHEN 'rectified'      THEN _row.planned_rectified_date
    WHEN 'pre_inspection' THEN _row.planned_pre_inspection_date
    WHEN 'dar_inspection' THEN _row.planned_dar_inspection_date
    WHEN 'closure'        THEN _row.planned_closure_date
    WHEN 'ho'             THEN _row.planned_ho_date
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public._snag_stage_actual_date(_row defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE _stage
    WHEN 'start'          THEN _row.actual_start_date
    WHEN 'rectified'      THEN _row.actual_rectified_date
    WHEN 'pre_inspection' THEN _row.actual_pre_inspection_date
    WHEN 'dar_inspection' THEN _row.actual_dar_inspection_date
    WHEN 'closure'        THEN _row.actual_closure_date
    WHEN 'ho'             THEN _row.actual_ho_date
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public._snag_stage_done(_row defect_items_raw, _stage text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE _stage
    WHEN 'ho' THEN _row.actual_ho_date IS NOT NULL
    WHEN 'closure' THEN
      _row.actual_closure_date IS NOT NULL
      OR _row.actual_ho_date IS NOT NULL
    WHEN 'dar_inspection' THEN
      _row.actual_dar_inspection_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR _row.actual_ho_date IS NOT NULL
    WHEN 'pre_inspection' THEN
      _row.actual_pre_inspection_date IS NOT NULL
      OR _row.actual_dar_inspection_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR _row.actual_ho_date IS NOT NULL
    WHEN 'rectified' THEN
      _row.actual_rectified_date IS NOT NULL
      OR _row.actual_pre_inspection_date IS NOT NULL
      OR _row.actual_dar_inspection_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR _row.actual_ho_date IS NOT NULL
    WHEN 'start' THEN
      _row.actual_start_date IS NOT NULL
      OR _row.actual_rectified_date IS NOT NULL
      OR _row.actual_pre_inspection_date IS NOT NULL
      OR _row.actual_dar_inspection_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR _row.actual_ho_date IS NOT NULL
    ELSE false
  END
$function$;

-- 3) 백필 되돌리기용 스냅샷 테이블
CREATE TABLE IF NOT EXISTS public.defect_stage_backfill_snapshot_20260809 (
  id uuid PRIMARY KEY,
  actual_closure_date date,
  prev_planned_pre_inspection_date date,
  prev_actual_pre_inspection_date date,
  prev_planned_dar_inspection_date date,
  prev_actual_dar_inspection_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.defect_stage_backfill_snapshot_20260809 TO authenticated;
GRANT ALL ON public.defect_stage_backfill_snapshot_20260809 TO service_role;

ALTER TABLE public.defect_stage_backfill_snapshot_20260809 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can read stage backfill snapshot 20260809"
ON public.defect_stage_backfill_snapshot_20260809
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));