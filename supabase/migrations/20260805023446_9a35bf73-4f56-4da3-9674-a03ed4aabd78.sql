ALTER TABLE public.abd_ocs_import_logs ADD COLUMN IF NOT EXISTS result jsonb;
NOTIFY pgrst, 'reload schema';