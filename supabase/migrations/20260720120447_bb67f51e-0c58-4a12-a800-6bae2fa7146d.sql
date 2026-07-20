ALTER TABLE public.dmr_entries DROP CONSTRAINT IF EXISTS dmr_entries_discipline_check;
ALTER TABLE public.dmr_system_master DROP CONSTRAINT IF EXISTS dmr_system_master_discipline_check;

UPDATE public.dmr_entries
SET discipline = 'ELEC', updated_at = now()
WHERE discipline = 'ELECT';

UPDATE public.dmr_system_master
SET discipline = 'ELEC', updated_at = now()
WHERE discipline = 'ELECT';

ALTER TABLE public.dmr_entries
  ADD CONSTRAINT dmr_entries_discipline_check
  CHECK (discipline IN ('ARCH', 'ELEC', 'MECH'));

ALTER TABLE public.dmr_system_master
  ADD CONSTRAINT dmr_system_master_discipline_check
  CHECK (discipline IN ('ARCH', 'ELEC', 'MECH'));

UPDATE public.team_master
SET aliases = (
  SELECT array_agg(DISTINCT alias ORDER BY alias)
  FROM unnest(coalesce(aliases, ARRAY[]::text[]) || ARRAY['ELECT', 'ELECTRICAL', '전기']) AS alias
),
updated_at = now()
WHERE code = 'ELEC';