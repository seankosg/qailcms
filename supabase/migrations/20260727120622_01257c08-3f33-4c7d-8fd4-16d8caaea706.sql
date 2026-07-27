-- tm_judge_at_date: TABLE → jsonb 배열
drop function if exists public.tm_judge_at_date(date, uuid[]);
create or replace function public.tm_judge_at_date(
  p_data_date date,
  p_task_ids uuid[] default null
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select
      t.id,
      (d->>'cum_plan_pct')::numeric   as cum_plan_pct,
      (d->>'cum_actual_pct')::numeric as cum_actual_pct,
      (d->>'gap_pct')::numeric        as gap_pct,
      (d->>'auto_judgment')::text     as auto_judgment,
      (d->>'delay_days')::integer     as delay_days,
      (d->>'alarm_reason')::text      as alarm_reason
    from public.task_management_raw t,
    lateral public.tm_compute_derived(
      t.plan_start, t.plan_end, t.plan_days,
      t.actual_start, t.actual_finish, t.actual_progress,
      coalesce(p_data_date, t.data_date, (current_timestamp at time zone 'Asia/Qatar')::date)
    ) d
    where t.is_active is not false
      and (p_task_ids is null or t.id = any(p_task_ids))
  ) x;
$function$;

grant execute on function public.tm_judge_at_date(date, uuid[]) to authenticated, service_role;

-- tm_today_actual: TABLE → jsonb 배열
drop function if exists public.tm_today_actual(uuid[], date);
create or replace function public.tm_today_actual(
  _ids uuid[],
  _as_of date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select
      t.id,
      (d->>'cum_actual_pct')::numeric as t_actual
    from public.task_management_raw t,
    lateral public.tm_compute_derived(
      t.plan_start, t.plan_end, t.plan_days,
      t.actual_start, t.actual_finish, t.actual_progress,
      coalesce(_as_of, t.data_date, (current_timestamp at time zone 'Asia/Qatar')::date)
    ) d
    where t.id = any(_ids)
  ) x;
$function$;

grant execute on function public.tm_today_actual(uuid[], date) to authenticated, service_role;