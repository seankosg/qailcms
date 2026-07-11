
create table public.task_management_raw (
  id uuid primary key default gen_random_uuid(),
  task_no text not null,
  parent_task_no text,
  level text not null check (level in ('parent','child')),
  discipline text not null check (discipline in ('건축','전기','설비')),
  category text,
  plot text,
  task_name text,
  risk text,
  sub_task_desc text,
  pic text,
  row_type text,
  status_manual text,
  plan_start date,
  plan_end date,
  plan_days int,
  actual_start date,
  actual_progress numeric(6,4),
  plan_progress numeric(6,4),
  progress_variance numeric(6,4),
  forecast_end date,
  slip_days int,
  auto_judgment text,
  data_date date not null,
  sort_order int,
  source_file text,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discipline, task_no)
);

grant select, insert, update, delete on public.task_management_raw to authenticated;
grant all on public.task_management_raw to service_role;

alter table public.task_management_raw enable row level security;

create policy "tmr read authenticated"
  on public.task_management_raw for select
  to authenticated using (true);

create policy "tmr admin write"
  on public.task_management_raw for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger tmr_set_updated_at
  before update on public.task_management_raw
  for each row execute function public.set_updated_at();

create index task_management_raw_discipline_idx on public.task_management_raw (discipline);
create index task_management_raw_parent_idx on public.task_management_raw (discipline, parent_task_no);
create index task_management_raw_sort_idx on public.task_management_raw (discipline, sort_order);

create table public.task_management_import_logs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  discipline text not null check (discipline in ('건축','전기','설비')),
  data_date date,
  sheet_name text,
  total_rows int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  rejected int not null default 0,
  errors jsonb,
  status text not null default 'success',
  imported_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.task_management_import_logs to authenticated;
grant all on public.task_management_import_logs to service_role;

alter table public.task_management_import_logs enable row level security;

create policy "tmil read authenticated"
  on public.task_management_import_logs for select
  to authenticated using (true);

create policy "tmil admin write"
  on public.task_management_import_logs for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger tmil_set_updated_at
  before update on public.task_management_import_logs
  for each row execute function public.set_updated_at();
