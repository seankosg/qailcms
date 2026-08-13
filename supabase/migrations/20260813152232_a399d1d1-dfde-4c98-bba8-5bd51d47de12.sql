alter table public.hdec_pic_name_master
  add column if not exists duty_title text,
  add column if not exists rank_title text,
  add column if not exists rank_level integer,
  add column if not exists team_code text,
  add column if not exists parent_pic_id uuid references public.hdec_pic_name_master(id) on delete set null,
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_hdec_pic_parent on public.hdec_pic_name_master(parent_pic_id);
create index if not exists idx_hdec_pic_team_code on public.hdec_pic_name_master(team_code);

alter table public.team_master
  add column if not exists target_headcount integer not null default 0;