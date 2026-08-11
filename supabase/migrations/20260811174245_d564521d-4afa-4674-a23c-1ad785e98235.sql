ALTER TABLE public.dmr_entries
  ADD COLUMN IF NOT EXISTS task_no text,
  ADD COLUMN IF NOT EXISTS task_level text,
  ADD COLUMN IF NOT EXISTS task_name text,
  ADD COLUMN IF NOT EXISTS work_category text,
  ADD COLUMN IF NOT EXISTS tplan_pct numeric,
  ADD COLUMN IF NOT EXISTS tactual_pct numeric,
  ADD COLUMN IF NOT EXISTS task_actual_start date,
  ADD COLUMN IF NOT EXISTS task_data_date date,
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS headcount_kind text NOT NULL DEFAULT 'worker',
  ADD COLUMN IF NOT EXISTS pic_name text;

ALTER TABLE public.dmr_entries
  DROP CONSTRAINT IF EXISTS dmr_entries_headcount_kind_check;
ALTER TABLE public.dmr_entries
  ADD CONSTRAINT dmr_entries_headcount_kind_check
  CHECK (headcount_kind IN ('worker','foreman','supervisor'));

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.dmr_entries'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(con.conkey) k
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
      ) = ARRAY['contractor_name','discipline','plot','report_date','system_name']::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.dmr_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.dmr_entries
  ADD CONSTRAINT dmr_entries_uniq_v2
  UNIQUE NULLS NOT DISTINCT (report_date, discipline, system_name, contractor_name, plot, task_no, headcount_kind);