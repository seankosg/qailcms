ALTER TABLE public.defect_items_raw
  DROP CONSTRAINT IF EXISTS defect_items_raw_team_check;

ALTER TABLE public.defect_items_raw
  ADD CONSTRAINT defect_items_raw_team_check
  CHECK (team IN ('Arch','Mech','Elec'));

ALTER TABLE public.defect_import_row_logs
  DROP CONSTRAINT IF EXISTS defect_import_row_logs_team_check;

ALTER TABLE public.defect_import_row_logs
  ADD CONSTRAINT defect_import_row_logs_team_check
  CHECK (team IS NULL OR team IN ('Arch','Mech','Elec'));
