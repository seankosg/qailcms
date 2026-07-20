
ALTER TABLE public.dmr_entries
  ADD COLUMN IF NOT EXISTS plan_manpower integer,
  ADD COLUMN IF NOT EXISTS actual_manpower integer;

DELETE FROM public.dmr_entries WHERE metric = 'yesterday';

CREATE TEMP TABLE _dmr_pivot AS
SELECT
  report_date, discipline, system_name, contractor_name, plot,
  MAX(CASE WHEN metric = 'target' THEN manpower END) AS plan_v,
  MAX(CASE WHEN metric = 'today'  THEN manpower END) AS actual_v,
  (array_agg(source_image_path) FILTER (WHERE source_image_path IS NOT NULL))[1] AS source_image_path,
  (array_agg(created_by)         FILTER (WHERE created_by IS NOT NULL))[1]         AS created_by,
  MIN(created_at) AS created_at
FROM public.dmr_entries
GROUP BY report_date, discipline, system_name, contractor_name, plot;

DELETE FROM public.dmr_entries;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.dmr_entries'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.dmr_entries DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.dmr_entries ALTER COLUMN metric DROP NOT NULL;
ALTER TABLE public.dmr_entries ALTER COLUMN manpower DROP NOT NULL;

INSERT INTO public.dmr_entries (
  report_date, discipline, system_name, contractor_name, plot,
  plan_manpower, actual_manpower, source_image_path, created_by, created_at, updated_at
)
SELECT
  report_date, discipline, system_name, contractor_name, plot,
  COALESCE(plan_v, 0), COALESCE(actual_v, 0), source_image_path, created_by,
  COALESCE(created_at, now()), now()
FROM _dmr_pivot;

ALTER TABLE public.dmr_entries
  ADD CONSTRAINT dmr_entries_unique_key
  UNIQUE (report_date, discipline, system_name, contractor_name, plot);

ALTER TABLE public.dmr_entries
  ADD COLUMN IF NOT EXISTS diff_manpower integer
  GENERATED ALWAYS AS (COALESCE(actual_manpower,0) - COALESCE(plan_manpower,0)) STORED;

ALTER TABLE public.dmr_entries ALTER COLUMN plan_manpower SET DEFAULT 0;
ALTER TABLE public.dmr_entries ALTER COLUMN actual_manpower SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dmr_entries_date_disc ON public.dmr_entries (report_date, discipline);
