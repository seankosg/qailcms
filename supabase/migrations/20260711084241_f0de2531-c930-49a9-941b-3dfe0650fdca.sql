
-- 1) task_management_settings: 임계값
create table if not exists public.task_management_settings (
  id text primary key default 'default',
  behind_warn_gap numeric(6,4) not null default -0.05,
  behind_late_gap numeric(6,4) not null default -0.15,
  slip_warn_days int not null default 3,
  slip_late_days int not null default 14,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.task_management_settings to authenticated;
grant all on public.task_management_settings to service_role;

alter table public.task_management_settings enable row level security;

create policy "tms read authenticated" on public.task_management_settings
  for select to authenticated using (true);
create policy "tms admin write" on public.task_management_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger tms_set_updated_at
  before update on public.task_management_settings
  for each row execute function public.set_updated_at();

insert into public.task_management_settings (id) values ('default')
  on conflict (id) do nothing;

-- 2) history 테이블
create table if not exists public.task_management_status_history (
  id uuid primary key default gen_random_uuid(),
  task_raw_id uuid references public.task_management_raw(id) on delete cascade,
  discipline text not null,
  task_no text not null,
  field text not null,
  old_value text,
  new_value text,
  source text not null default 'manual' check (source in ('manual','import','rollup','system')),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

grant select, insert, update, delete on public.task_management_status_history to authenticated;
grant all on public.task_management_status_history to service_role;

alter table public.task_management_status_history enable row level security;

create policy "tmsh read authenticated" on public.task_management_status_history
  for select to authenticated using (true);
create policy "tmsh admin write" on public.task_management_status_history
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index if not exists tmsh_task_idx on public.task_management_status_history (discipline, task_no);
create index if not exists tmsh_changed_at_idx on public.task_management_status_history (changed_at desc);

-- 3) task_management_raw 컬럼 추가
alter table public.task_management_raw
  add column if not exists auto_judgment_import text,
  add column if not exists is_rollup boolean not null default false;

-- 4) auto_judgment 규칙 함수
create or replace function public.calc_auto_judgment_value(
  _actual_progress numeric,
  _plan_start date,
  _plan_end date,
  _slip_days int
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  s record;
  today_date date := current_date;
  expected numeric;
  gap numeric;
  total_days int;
  elapsed int;
begin
  select behind_warn_gap, behind_late_gap, slip_warn_days, slip_late_days
    into s from public.task_management_settings where id='default';
  if not found then
    return null;
  end if;

  if _actual_progress is not null and _actual_progress >= 1 then
    return '완료';
  end if;

  if _plan_start is null or _plan_end is null then
    expected := 0;
  else
    total_days := (_plan_end - _plan_start);
    if total_days <= 0 then
      expected := case when today_date >= _plan_end then 1 else 0 end;
    else
      elapsed := (today_date - _plan_start);
      expected := greatest(0, least(1, elapsed::numeric / total_days::numeric));
    end if;
  end if;

  gap := coalesce(_actual_progress, 0) - expected;

  if (gap < s.behind_late_gap) or (coalesce(_slip_days,0) > s.slip_late_days) then
    return '위험';
  elsif (gap < s.behind_warn_gap) or (coalesce(_slip_days,0) > s.slip_warn_days) then
    return '지연';
  elsif gap < 0 then
    return '주의';
  else
    return '정상';
  end if;
end;
$$;

-- 5) 자동 롤업 함수
create or replace function public.update_task_summary(
  _discipline text,
  _parent_task_no text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  agg record;
  worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
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
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline
    and parent_task_no = _parent_task_no
    and level = 'child';

  if agg.cnt = 0 then return; end if;

  -- worst auto_judgment
  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and parent_task_no=_parent_task_no
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
         forecast_end = agg.fe,
         slip_days = agg.sd,
         auto_judgment = coalesce(worst, auto_judgment),
         is_rollup = true
   where discipline = _discipline
     and task_no = _parent_task_no
     and level = 'parent';
end;
$$;

-- 6) 롤업 트리거 함수
create or replace function public.trg_task_rollup_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 재귀 방지: 롤업으로 인한 parent 업데이트는 다시 트리거 실행하지 않음
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.parent_task_no is not null and old.level = 'child' then
      perform public.update_task_summary(old.discipline, old.parent_task_no);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.parent_task_no is distinct from new.parent_task_no
       and old.parent_task_no is not null
       and old.level = 'child' then
      perform public.update_task_summary(old.discipline, old.parent_task_no);
    end if;
  end if;

  if new.parent_task_no is not null and new.level = 'child' then
    perform public.update_task_summary(new.discipline, new.parent_task_no);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_rollup on public.task_management_raw;
create trigger trg_task_rollup
after insert or update of actual_progress, plan_progress, plan_start, plan_end,
  plan_days, slip_days, forecast_end, actual_start, parent_task_no, level, auto_judgment
  or delete
on public.task_management_raw
for each row execute function public.trg_task_rollup_fn();

-- 7) history 트리거 함수
create or replace function public.trg_task_history_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src text;
  uid uuid;
begin
  begin
    src := coalesce(current_setting('app.change_source', true), 'manual');
  exception when others then src := 'manual';
  end;
  begin
    uid := nullif(current_setting('app.change_user', true), '')::uuid;
  exception when others then uid := null;
  end;

  if new.actual_progress is distinct from old.actual_progress then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_progress',
      old.actual_progress::text, new.actual_progress::text, src, uid);
  end if;
  if new.plan_progress is distinct from old.plan_progress then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_progress',
      old.plan_progress::text, new.plan_progress::text, src, uid);
  end if;
  if new.plan_start is distinct from old.plan_start then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_start',
      old.plan_start::text, new.plan_start::text, src, uid);
  end if;
  if new.plan_end is distinct from old.plan_end then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_end',
      old.plan_end::text, new.plan_end::text, src, uid);
  end if;
  if new.actual_start is distinct from old.actual_start then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_start',
      old.actual_start::text, new.actual_start::text, src, uid);
  end if;
  if new.forecast_end is distinct from old.forecast_end then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'forecast_end',
      old.forecast_end::text, new.forecast_end::text, src, uid);
  end if;
  if new.slip_days is distinct from old.slip_days then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'slip_days',
      old.slip_days::text, new.slip_days::text, src, uid);
  end if;
  if new.auto_judgment is distinct from old.auto_judgment then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'auto_judgment',
      old.auto_judgment, new.auto_judgment, src, uid);
  end if;
  if new.status_manual is distinct from old.status_manual then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'status_manual',
      old.status_manual, new.status_manual, src, uid);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_history on public.task_management_raw;
create trigger trg_task_history
after update on public.task_management_raw
for each row execute function public.trg_task_history_fn();

-- 8) discipline 별 auto_judgment 일괄 재계산 함수
create or replace function public.recalc_task_auto_judgment(_discipline text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  update public.task_management_raw t
    set auto_judgment = public.calc_auto_judgment_value(t.actual_progress, t.plan_start, t.plan_end, t.slip_days)
  where (_discipline is null or t.discipline = _discipline);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 9) discipline 별 모든 parent 롤업 함수
create or replace function public.rollup_task_all_parents(_discipline text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct parent_task_no
      from public.task_management_raw
     where discipline = _discipline
       and level = 'child'
       and parent_task_no is not null
  loop
    perform public.update_task_summary(_discipline, r.parent_task_no);
    n := n + 1;
  end loop;
  return n;
end;
$$;
