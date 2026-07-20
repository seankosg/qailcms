
-- 1) Drop old function (signature change)
DROP FUNCTION IF EXISTS public.calc_auto_judgment_value(numeric, date, date, integer);

-- 2) New function: 3-stage worstOf using T.Plan
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
  t_plan numeric;
  gap numeric;
  actual numeric := coalesce(_actual_progress, 0);
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
begin
  select behind_warn_gap, behind_late_gap, slip_warn_days, slip_late_days
    into s from public.task_management_settings where id='default';
  if not found then return null; end if;

  as_of := coalesce(_data_date, current_date);

  -- Start stage
  if _actual_start is not null then
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

  -- WIP stage
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

  -- Finish stage
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

  -- Row aggregation: worstOf, exclude Start once actually started; all-completion => 완료
  if j_wip = '완료' and j_finish = '완료' then
    return '완료';
  end if;

  if _actual_start is null then
    candidates := array[j_start, j_wip, j_finish];
  else
    candidates := array[j_wip, j_finish];
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

-- 3) Update recalc RPC to use new signature
CREATE OR REPLACE FUNCTION public.recalc_task_auto_judgment(_discipline text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  n int := 0;
begin
  update public.task_management_raw t
    set auto_judgment = public.calc_auto_judgment_value(
      t.actual_progress,
      t.plan_start,
      t.plan_end,
      t.plan_days,
      t.actual_start,
      t.actual_finish,
      t.data_date,
      t.slip_days
    )
  where (_discipline is null or t.discipline = _discipline);
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- 4) One-time full recalc
SELECT public.recalc_task_auto_judgment(NULL);
