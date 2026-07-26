
-- 1) 새 임계치 컬럼 추가
ALTER TABLE public.task_management_settings
  ADD COLUMN IF NOT EXISTS caution_gap_buffer numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS worsen_gap numeric NOT NULL DEFAULT -0.15;

-- 2) 기존 임계치 컬럼 제거
ALTER TABLE public.task_management_settings
  DROP COLUMN IF EXISTS behind_warn_gap,
  DROP COLUMN IF EXISTS behind_late_gap,
  DROP COLUMN IF EXISTS slip_warn_days,
  DROP COLUMN IF EXISTS slip_late_days;

-- 3) 판정 함수 재작성 (gap 단일 소스, '악화' 반환)
CREATE OR REPLACE FUNCTION public.calc_auto_judgment_value(
  _actual_progress numeric,
  _plan_start date,
  _plan_end date,
  _plan_days integer,
  _actual_start date,
  _actual_finish date,
  _data_date date,
  _slip_days integer
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
declare
  s record;
  as_of date;
  duration_days int;
  elapsed int;
  cum_plan numeric;
  gap numeric;
  actual numeric := least(1, greatest(0, coalesce(_actual_progress, 0)));
  started boolean;
  caution numeric;
  worsen numeric;
begin
  select caution_gap_buffer, worsen_gap into s
    from public.task_management_settings where id = 'default';
  if found then
    caution := coalesce(s.caution_gap_buffer, 0.05);
    worsen  := coalesce(s.worsen_gap, -0.15);
  else
    caution := 0.05;
    worsen  := -0.15;
  end if;

  as_of := coalesce(_data_date, current_date);
  started := _actual_start is not null or actual > 0;

  -- 완료
  if actual >= 1 then return '완료'; end if;

  -- 미착수: plan_start 도래 시 '지연', 아니면 '정상'
  if not started then
    if _plan_start is not null and _plan_start <= as_of then
      return '지연';
    end if;
    return '정상';
  end if;

  -- 착수 이후: gap 단일 소스
  if _plan_start is null then
    return '정상';
  end if;

  if _plan_days is not null and _plan_days > 0 then
    duration_days := _plan_days;
  elsif _plan_end is not null then
    duration_days := greatest(1, _plan_end - _plan_start);
  else
    duration_days := null;
  end if;

  if duration_days is null then
    return '정상';
  end if;

  elapsed := as_of - _plan_start;
  cum_plan := greatest(0, least(1, elapsed::numeric / duration_days::numeric));
  gap := actual - cum_plan;

  if gap < worsen then return '악화'; end if;
  if gap < 0 then return '지연'; end if;
  if gap < caution then return '주의'; end if;
  return '정상';
end;
$function$;
