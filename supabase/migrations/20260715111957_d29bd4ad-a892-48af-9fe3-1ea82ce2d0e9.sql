alter table public.team_master
  add column if not exists aliases text[] not null default '{}';

create index if not exists idx_team_master_aliases
  on public.team_master using gin (aliases);

-- 기본 시딩된 team에 대해서만 별칭 보정 (기존 aliases가 비어있을 때만)
update public.team_master
   set aliases = array['설비','MECHANICAL']
 where code = 'MECH' and (aliases is null or cardinality(aliases) = 0);

update public.team_master
   set aliases = array['전기','ELECTRICAL']
 where code = 'ELEC' and (aliases is null or cardinality(aliases) = 0);

update public.team_master
   set aliases = array['건축','ARCHITECT','ARCHITECTURAL']
 where code = 'ARCH' and (aliases is null or cardinality(aliases) = 0);