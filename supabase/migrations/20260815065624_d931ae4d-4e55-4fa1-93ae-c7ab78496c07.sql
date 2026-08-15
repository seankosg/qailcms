create or replace function public.org_demob_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'system_administrator')
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and coalesce(nullif(trim(p.hdec_pic_name),''), trim(p.name))
              in ('신원재','채홍욱','성영광','김영서','김대수','정경호')
      );
$$;

grant execute on function public.org_demob_can_view() to authenticated;

create or replace function public.org_demob_plan()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  _out jsonb;
begin
  if not public.org_demob_can_view() then
    raise exception 'org_demob_plan: not authorized';
  end if;

  with tm as (
    select public.hdec_name_norm(hdec_pic_name) as nn,
           max(nullif(trim(hdec_pic_name),'')) as raw_name,
           'tm'::text as m,
           min(plan_start) as d0,
           max(coalesce(actual_finish, forecast_end, plan_end)) as d1,
           count(*) as n
      from public.task_management_raw
     where coalesce(is_active,true)
       and nullif(trim(hdec_pic_name),'') is not null
     group by 1
  ), sm as (
    select public.hdec_name_norm(hdec_pic_name) as nn,
           max(nullif(trim(hdec_pic_name),'')) as raw_name,
           'sm'::text as m,
           min(coalesce(actual_start_date, planned_start_date)) as d0,
           max(greatest(
             coalesce(actual_ho_date, planned_ho_date, '1900-01-01'::date),
             coalesce(actual_closure_date, planned_closure_date, '1900-01-01'::date)
           )) as d1,
           count(*) as n
      from public.defect_items_raw
     where coalesce(is_active,true)
       and nullif(trim(hdec_pic_name),'') is not null
     group by 1
  ), abd as (
    select public.hdec_name_norm(hdec_pic_name) as nn,
           max(nullif(trim(hdec_pic_name),'')) as raw_name,
           'abd'::text as m,
           min(coalesce(r1_draft_start_actual, r1_draft_start_plan)) as d0,
           max(greatest(
             coalesce(approval_date,'1900-01-01'::date),
             coalesce(r3_dar_actual, r3_dar_plan, '1900-01-01'::date),
             coalesce(r2_dar_actual, r2_dar_plan, '1900-01-01'::date),
             coalesce(r1_dar_actual, r1_dar_plan, '1900-01-01'::date)
           )) as d1,
           count(*) as n
      from public.abd_items_raw
     where coalesce(is_active,true)
       and nullif(trim(hdec_pic_name),'') is not null
     group by 1
  ), spl as (
    select public.hdec_name_norm(i.pic) as nn,
           max(nullif(trim(i.pic),'')) as raw_name,
           'spl'::text as m,
           min(coalesce(p.actual_start, p.plan_start)) as d0,
           max(coalesce(p.actual_finish, p.plan_finish)) as d1,
           count(distinct i.id) as n
      from public.spl_items i
      join public.spl_stage_progress p on p.item_id = i.id
     where coalesce(i.is_active,true) and not coalesce(i.is_excluded,false)
       and not coalesce(p.na_flag,false)
       and nullif(trim(i.pic),'') is not null
     group by 1
  ), wrt as (
    select public.hdec_name_norm(i.pic) as nn,
           max(nullif(trim(i.pic),'')) as raw_name,
           'wrt'::text as m,
           min(coalesce(p.actual_start, p.plan_start)) as d0,
           max(coalesce(p.actual_finish, p.plan_finish)) as d1,
           count(distinct i.id) as n
      from public.wrt_items i
      join public.wrt_stage_progress p on p.item_id = i.id
     where coalesce(i.is_active,true) and not coalesce(i.is_excluded,false)
       and not coalesce(p.na_flag,false)
       and nullif(trim(i.pic),'') is not null
     group by 1
  ), unioned as (
    select * from tm
    union all select * from sm
    union all select * from abd
    union all select * from spl
    union all select * from wrt
  ), cleaned as (
    select nn, raw_name, m, n,
           nullif(d0,'1900-01-01'::date) as d0,
           nullif(d1,'1900-01-01'::date) as d1
      from unioned
     where nn is not null and nn <> ''
  ), agg as (
    select c.nn,
           coalesce(max(pm.name), max(c.raw_name)) as pic_name,
           coalesce(max(tmm.name), max(pm.team_code)) as team,
           coalesce(max(tmm.sort_order), 9999) as team_sort,
           bool_or(pm.id is not null) as in_master,
           min(c.d0) as first_date,
           max(c.d1) as demob_date,
           jsonb_object_agg(c.m, jsonb_build_object('start', c.d0, 'end', c.d1, 'count', c.n)) as per_module
      from cleaned c
      left join public.hdec_pic_name_master pm on pm.name_norm = c.nn and coalesce(pm.is_active,true)
      left join public.team_master tmm on tmm.code = pm.team_code
     group by c.nn
  )
  select jsonb_build_object(
           'generated_at', now(),
           'rows', coalesce(jsonb_agg(to_jsonb(a) order by a.team_sort, a.team nulls last, a.pic_name), '[]'::jsonb)
         )
    into _out
    from agg a;

  return _out;
end;
$function$;