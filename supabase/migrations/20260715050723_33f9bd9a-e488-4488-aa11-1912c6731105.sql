
UPDATE public.defect_items_raw SET team = UPPER(team) WHERE team IS NOT NULL AND team <> UPPER(team);

ALTER TABLE public.task_management_raw ADD CONSTRAINT task_management_raw_discipline_check CHECK (discipline = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.task_management_import_logs ADD CONSTRAINT task_management_import_logs_discipline_check CHECK (discipline IS NULL OR discipline = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.defect_items_raw ADD CONSTRAINT defect_items_raw_team_check CHECK (team IS NULL OR team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.defect_import_row_logs ADD CONSTRAINT defect_import_row_logs_team_check CHECK (team IS NULL OR team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.defect_import_logs ADD CONSTRAINT defect_import_logs_team_check CHECK (team IS NULL OR team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.defect_category_team_map ADD CONSTRAINT defect_category_team_map_team_check CHECK (team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.abd_items_raw ADD CONSTRAINT abd_items_raw_team_check CHECK (team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
ALTER TABLE public.abd_import_logs ADD CONSTRAINT abd_import_logs_team_check CHECK (team IS NULL OR team = ANY (ARRAY['ARCH','MECH','ELEC','DESN','PRJC']::text[]));
