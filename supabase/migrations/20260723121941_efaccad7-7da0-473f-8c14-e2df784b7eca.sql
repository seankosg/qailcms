ALTER TABLE public.abd_header_mappings
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE public.abd_header_mappings SET is_active = active WHERE is_active IS DISTINCT FROM active;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'abd_header_mappings_team_source_header_key'
  ) THEN
    ALTER TABLE public.abd_header_mappings
      ADD CONSTRAINT abd_header_mappings_team_source_header_key UNIQUE (team, source_header);
  END IF;
END $$;