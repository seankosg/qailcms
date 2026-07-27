ALTER TABLE public.abd_import_logs ALTER COLUMN team DROP NOT NULL;

UPDATE public.abd_import_logs
SET team = NULL
WHERE sheet_name = 'Docs (Aconex)';