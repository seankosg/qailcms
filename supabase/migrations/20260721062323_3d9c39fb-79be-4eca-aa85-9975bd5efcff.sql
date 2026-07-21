CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  agg record;
  worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
  _ad integer;
begin
  if _parent_task_no is null then return; end if;

  select
    sum(coalesce(actual_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(coalesce(plan_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps,
    max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_,
    max(actual_finish) as af_,
    bool_and(actual_finish is not null or coalesce(actual_progress,0) >= 1) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline
    and main_task_no = _parent_task_no
    and level = 'child';

  if agg.cnt = 0 then return; end if;

  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := (current_date - agg.as_) + 1;
  end if;

  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_parent_task_no
      and level='child' and auto_judgment = x.r
  )
  order by idx
  limit 1;

  update public.task_management_raw
     set actual_progress = round(coalesce(agg.ap,0)::numeric, 4),
         plan_progress = round(coalesce(agg.pp,0)::numeric, 4),
         progress_variance = round(coalesce(agg.ap,0)::numeric - coalesce(agg.pp,0)::numeric, 4),
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
     and level = 'parent';
end;
$function$;