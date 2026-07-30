CREATE OR REPLACE FUNCTION public.tm_today_actual(_ids uuid[], _as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- T.Actual = (as_of 시점 누계) − (직전 관측 누계). 증분이 음수(하향 정정)면 음수 그대로 반환.
  -- 스케일 정합: 이력/현재값이 1을 초과하면 백분율 표기로 보고 /100 정규화 후 [0,1] 클램프.
  with cur as (
    select t.id,
      least(1, greatest(0,
        case when coalesce(t.actual_progress,0) > 1 then coalesce(t.actual_progress,0)/100
             else coalesce(t.actual_progress,0) end))::numeric as cum
    from public.task_management_raw t
    where t.id = any(_ids)
  ),
  gen as (
    select c.id, c.cum,
      (select max(h.changed_at) from public.task_management_status_history h
        where h.task_raw_id = c.id and h.field='actual_progress' and h.new_value is not null
          and (h.changed_at at time zone 'Asia/Qatar')::date <= _as_of) as last_ts
    from cur c
  ),
  atdate as (
    select g.id, g.last_ts,
      -- as_of 시점 누계: 그 시점까지의 마지막 기록값(없으면 현재 누계)
      coalesce(
        (select least(1, greatest(0,
            case when h.new_value::numeric > 1 then h.new_value::numeric/100 else h.new_value::numeric end))
          from public.task_management_status_history h
          where h.task_raw_id = g.id and h.field='actual_progress' and h.new_value is not null
            and h.new_value ~ '^-?[0-9.]+$'
            and h.changed_at = g.last_ts
          order by h.changed_at desc limit 1),
        g.cum) as cum
    from gen g
  ),
  prev as (
    select a.id, a.cum,
      coalesce(
        (select least(1, greatest(0,
            case when h.new_value::numeric > 1 then h.new_value::numeric/100 else h.new_value::numeric end))
          from public.task_management_status_history h
          where h.task_raw_id = a.id and h.field='actual_progress' and h.new_value is not null
            and h.new_value ~ '^-?[0-9.]+$'
            and h.changed_at < a.last_ts
          order by h.changed_at desc limit 1),
        (select least(1, greatest(0,
            case when h.old_value::numeric > 1 then h.old_value::numeric/100 else h.old_value::numeric end))
          from public.task_management_status_history h
          where h.task_raw_id = a.id and h.field='actual_progress' and h.old_value is not null
            and h.old_value ~ '^-?[0-9.]+$'
            and h.changed_at = a.last_ts
          order by h.changed_at desc limit 1)
      ) as prev_cum
    from atdate a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    't_actual', (p.cum - coalesce(p.prev_cum, p.cum))
  )), '[]'::jsonb)
  from prev p;
$function$;