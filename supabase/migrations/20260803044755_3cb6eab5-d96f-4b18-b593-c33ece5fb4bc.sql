CREATE OR REPLACE FUNCTION public.trg_task_actual_duration_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- R1-9: 미완료(actual_finish IS NULL) 항목은 actual_duration 을 저장하지 않는다.
  if new.actual_start is null or new.actual_finish is null then
    new.actual_duration := null;
  else
    new.actual_duration := (new.actual_finish - new.actual_start) + 1;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_task_actual_duration ON public.task_management_raw;
CREATE TRIGGER trg_task_actual_duration
  BEFORE INSERT OR UPDATE ON public.task_management_raw
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_actual_duration_fn();

CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  agg record;
  worst_sub text;
  worst_main text;
  worst text;
  rank_order text[] := array['악화','지연','주의','정상','완료'];
  _ad integer;
  _data_date date;
  _plan_days integer;
  _actual_progress numeric;
  _plan_start date;
  _plan_end date;
  _actual_start date;
  _actual_finish date;
  _slip_days integer;
  _as_of date;
  _tplan numeric;
  _act numeric;
  _gap numeric;
  _judg text;
  _delay integer;
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
    bool_and(actual_finish is not null) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline and main_task_no = _parent_task_no and level = 'sub';

  if agg.cnt = 0 then return; end if;

  -- R1-9: 하위가 모두 완료되기 전이면 Main 의 actual_duration 은 NULL
  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := null;
  end if;

  select r into worst_sub from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_parent_task_no and level='sub' and auto_judgment = x.r
  ) order by idx limit 1;

  select data_date, plan_days, actual_progress, plan_start, plan_end, actual_start, actual_finish, slip_days
    into _data_date, _plan_days, _actual_progress, _plan_start, _plan_end, _actual_start, _actual_finish, _slip_days
  from public.task_management_raw
  where discipline = _discipline and task_no = _parent_task_no and level = 'main' limit 1;

  _as_of := coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);
  _act := public.tm_kpi_norm_actual(coalesce(agg.ap, _actual_progress));
  _tplan := public.tm_main_tplan(_discipline, _parent_task_no, _as_of);
  _gap := case when _tplan is null then null else _act - _tplan end;
  _judg := public.tm_kpi_judgment_g(
    _act,
    case when agg.all_finished then coalesce(_actual_finish, agg.af_) else _actual_finish end,
    coalesce(_actual_start, agg.as_),
    coalesce(_plan_start, agg.ps), _as_of, _gap, NULL, NULL);
  _delay := case
    when _act >= 1 and coalesce(_actual_finish, agg.af_) is not null and coalesce(_plan_end, agg.pe) is not null
         and coalesce(_actual_finish, agg.af_) > coalesce(_plan_end, agg.pe)
      then coalesce(_actual_finish, agg.af_) - coalesce(_plan_end, agg.pe)
    when _act < 1 and coalesce(_plan_end, agg.pe) is not null and _as_of > coalesce(_plan_end, agg.pe)
      then _as_of - coalesce(_plan_end, agg.pe)
    else 0 end;

  worst_main := _judg;
  if not agg.all_finished and worst_main = '완료' then
    worst_main := coalesce(worst_sub, '정상');
  end if;

  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where x.r = coalesce(worst_sub, '정상') or x.r = coalesce(worst_main, '정상')
  order by idx limit 1;

  update public.task_management_raw
     set actual_progress = coalesce(agg.ap, actual_progress),
         plan_progress   = coalesce(agg.pp, plan_progress),
         plan_start      = coalesce(plan_start, agg.ps),
         plan_end        = coalesce(plan_end, agg.pe),
         plan_days       = coalesce(plan_days, agg.pd::int),
         actual_start    = coalesce(actual_start, agg.as_),
         actual_finish   = case when agg.all_finished then coalesce(actual_finish, agg.af_) else actual_finish end,
         actual_duration = _ad,
         forecast_end    = coalesce(forecast_end, agg.fe),
         slip_days       = coalesce(slip_days, agg.sd),
         auto_judgment   = coalesce(worst, auto_judgment),
         cum_plan_pct    = _tplan,
         cum_actual_pct  = _act,
         gap_pct         = _gap,
         delay_days      = _delay,
         alarm_reason    = case when _gap is null then '계획정보 부족' else 'Gap ' || round(_gap*100, 1) || '%' end,
         updated_at      = now()
   where discipline = _discipline and task_no = _parent_task_no and level = 'main';
end;
$function$;