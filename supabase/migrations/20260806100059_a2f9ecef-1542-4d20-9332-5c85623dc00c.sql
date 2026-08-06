alter table public.abd_import_logs
  add column if not exists data_date date,
  add column if not exists parsed_rows integer,
  add column if not exists applied_rows integer,
  add column if not exists exclusions jsonb;