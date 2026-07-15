ALTER TABLE public.spare_parts_raw ADD COLUMN IF NOT EXISTS team text;
CREATE INDEX IF NOT EXISTS idx_spare_parts_raw_team ON public.spare_parts_raw (team);
DROP TRIGGER IF EXISTS trg_spare_parts_raw_validate_team ON public.spare_parts_raw;
CREATE TRIGGER trg_spare_parts_raw_validate_team
BEFORE INSERT OR UPDATE OF team ON public.spare_parts_raw
FOR EACH ROW EXECUTE FUNCTION public.validate_team_code();