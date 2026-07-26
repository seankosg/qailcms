
-- 1. TM/DMR 진도율 클램프 트리거 함수
CREATE OR REPLACE FUNCTION public.clamp_tm_progress_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actual_progress IS NOT NULL THEN
    IF NEW.actual_progress > 1 THEN
      NEW.actual_progress := NEW.actual_progress / 100.0;
    END IF;
    NEW.actual_progress := LEAST(1, GREATEST(0, NEW.actual_progress));
  END IF;
  IF NEW.plan_progress IS NOT NULL THEN
    IF NEW.plan_progress > 1 THEN
      NEW.plan_progress := NEW.plan_progress / 100.0;
    END IF;
    NEW.plan_progress := LEAST(1, GREATEST(0, NEW.plan_progress));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tm_clamp_progress ON public.task_management_raw;
CREATE TRIGGER trg_tm_clamp_progress
BEFORE INSERT OR UPDATE OF actual_progress, plan_progress
ON public.task_management_raw
FOR EACH ROW EXECUTE FUNCTION public.clamp_tm_progress_fn();

CREATE OR REPLACE FUNCTION public.clamp_dmr_progress_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actual_progress_pct IS NOT NULL THEN
    IF NEW.actual_progress_pct > 1 THEN
      NEW.actual_progress_pct := NEW.actual_progress_pct / 100.0;
    END IF;
    NEW.actual_progress_pct := LEAST(1, GREATEST(0, NEW.actual_progress_pct));
  END IF;
  IF NEW.planned_progress_pct IS NOT NULL THEN
    IF NEW.planned_progress_pct > 1 THEN
      NEW.planned_progress_pct := NEW.planned_progress_pct / 100.0;
    END IF;
    NEW.planned_progress_pct := LEAST(1, GREATEST(0, NEW.planned_progress_pct));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dmr_clamp_progress ON public.defect_items_raw;
CREATE TRIGGER trg_dmr_clamp_progress
BEFORE INSERT OR UPDATE OF actual_progress_pct, planned_progress_pct
ON public.defect_items_raw
FOR EACH ROW EXECUTE FUNCTION public.clamp_dmr_progress_fn();

-- 2. update_task_summary 정규화
CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  agg record;
  worst_sub text;
  worst_main text;
  worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
  _ad integer;
  _data_date date;
  _plan_days integer;
  _actual_progress numeric;
  _plan_start date;
  _plan_end date;
  _actual_start date;
  _actual_finish date;
  _slip_days integer;
begin
  if _parent_task_no is null then return; end if;

  select
    sum(least(1, greatest(0, coalesce(actual_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(least(1, greatest(0, coalesce(plan_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps,
    max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_,
    max(actual_finish) as af_,
    bool_and(actual_finish is not null or least(1, greatest(0, coalesce(actual_progress,0))) >= 1) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline
    and main_task_no = _parent_task_no
    and level = 'sub';

  if agg.cnt = 0 then return; end if;

  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := (current_date - agg.as_) + 1;
  end if;

  select r into worst_sub from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_parent_task_no
      and level='sub' and auto_judgment = x.r
  )
  order by idx
  limit 1;

  select data_date, plan_days, actual_progress, plan_start, plan_end, actual_start, actual_finish, slip_days
    into _data_date, _plan_days, _actual_progress, _plan_start, _plan_end, _actual_start, _actual_finish, _slip_days
  from public.task_management_raw
  where discipline = _discipline and task_no = _parent_task_no and level = 'main'
  limit 1;

  worst_main := public.calc_auto_judgment_value(
    _actual_progress, _plan_start, _plan_end, _plan_days,
    _actual_start, _actual_finish, _data_date, _slip_days
  );

  -- kids 가 모두 완료가 아니면 main 은 어떤 경우에도 '완료'가 아님
  if not agg.all_finished and worst_main = '완료' then
    worst_main := coalesce(worst_sub, '정상');
  end if;

  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where x.r = coalesce(worst_sub, '정상') or x.r = coalesce(worst_main, '정상')
  order by idx
  limit 1;

  update public.task_management_raw
     set actual_progress = round(least(1, greatest(0, coalesce(agg.ap,0)))::numeric, 4),
         plan_progress = round(least(1, greatest(0, coalesce(agg.pp,0)))::numeric, 4),
         progress_variance = round(
           least(1, greatest(0, coalesce(agg.ap,0)))::numeric
           - least(1, greatest(0, coalesce(agg.pp,0)))::numeric, 4),
         plan_start = agg.ps,
         plan_end = agg.pe,
         plan_days = agg.pd,
         actual_start = agg.as_,
         actual_finish = case when agg.all_finished then agg.af_ else null end,
         actual_duration = _ad,
         forecast_end = agg.fe,
         slip_days = agg.sd,
         auto_judgment = coalesce(worst, auto_judgment),
         is_rollup = true
   where discipline = _discipline
     and task_no = _parent_task_no
     and level = 'main';
end;
$function$;

-- 3. calc_auto_judgment_value 진입부 정규화
CREATE OR REPLACE FUNCTION public.calc_auto_judgment_value(_actual_progress numeric, _plan_start date, _plan_end date, _plan_days integer, _actual_start date, _actual_finish date, _data_date date, _slip_days integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  s record;
  as_of date;
  duration_days int;
  elapsed int;
  t_plan numeric;
  gap numeric;
  actual numeric := least(1, greatest(0, coalesce(_actual_progress, 0)));
  slip int := coalesce(_slip_days, 0);
  j_start text := '정상';
  j_wip text := '정상';
  j_finish text := '정상';
  d int;
  rank_map jsonb := '{"위험":0,"지연":1,"주의":2,"정상":3,"완료":4}'::jsonb;
  best text := '정상';
  best_rank int := 99;
  candidates text[];
  c text;
  r int;
  started boolean;
begin
  select behind_warn_gap, behind_late_gap, slip_warn_days, slip_late_days
    into s from public.task_management_settings where id='default';
  if not found then return null; end if;

  as_of := coalesce(_data_date, current_date);
  started := _actual_start is not null or actual > 0;

  if started then
    j_start := '완료';
  elsif _plan_start is null or _plan_start > as_of then
    j_start := '정상';
  else
    d := as_of - _plan_start;
    if d > s.slip_late_days then j_start := '위험';
    elsif d > s.slip_warn_days then j_start := '지연';
    elsif d > 0 then j_start := '주의';
    else j_start := '정상';
    end if;
  end if;

  if actual >= 1 then
    j_wip := '완료';
  elsif _plan_start is null then
    j_wip := '정상';
  else
    if _plan_days is not null and _plan_days > 0 then
      duration_days := _plan_days;
    elsif _plan_end is not null then
      duration_days := greatest(1, _plan_end - _plan_start);
    else
      duration_days := null;
    end if;
    if duration_days is null then
      j_wip := '정상';
    else
      elapsed := as_of - _plan_start;
      t_plan := greatest(0, least(1, elapsed::numeric / duration_days::numeric));
      gap := actual - t_plan;
      if gap < s.behind_late_gap then j_wip := '위험';
      elsif gap < s.behind_warn_gap then j_wip := '지연';
      elsif gap < 0 then j_wip := '주의';
      else j_wip := '정상';
      end if;
    end if;
  end if;

  if actual >= 1 and _actual_finish is not null then
    j_finish := '완료';
  elsif _plan_end is null or _plan_end > as_of then
    j_finish := '정상';
  else
    d := case when slip > 0 then slip else (as_of - _plan_end) end;
    if d > s.slip_late_days then j_finish := '위험';
    elsif d > s.slip_warn_days then j_finish := '지연';
    elsif d > 0 then j_finish := '주의';
    else j_finish := '정상';
    end if;
  end if;

  if j_wip = '완료' and j_finish = '완료' then
    return '완료';
  end if;

  if started then
    candidates := array[j_wip, j_finish];
  else
    candidates := array[j_start, j_wip, j_finish];
  end if;

  foreach c in array candidates loop
    r := coalesce((rank_map ->> c)::int, 99);
    if r < best_rank then
      best_rank := r;
      best := c;
    end if;
  end loop;

  return best;
end;
$function$;
