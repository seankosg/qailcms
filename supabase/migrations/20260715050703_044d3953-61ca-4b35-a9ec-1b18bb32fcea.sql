
ALTER TABLE public.task_management_raw DROP CONSTRAINT IF EXISTS task_management_raw_discipline_check;
ALTER TABLE public.task_management_import_logs DROP CONSTRAINT IF EXISTS task_management_import_logs_discipline_check;
ALTER TABLE public.defect_import_logs DROP CONSTRAINT IF EXISTS defect_import_logs_team_check;
ALTER TABLE public.abd_items_raw DROP CONSTRAINT IF EXISTS abd_items_raw_team_check;
ALTER TABLE public.abd_import_logs DROP CONSTRAINT IF EXISTS abd_import_logs_team_check;
ALTER TABLE public.defect_category_team_map DROP CONSTRAINT IF EXISTS defect_category_team_map_team_check;
ALTER TABLE public.defect_items_raw DROP CONSTRAINT IF EXISTS defect_items_raw_team_check;
ALTER TABLE public.defect_import_row_logs DROP CONSTRAINT IF EXISTS defect_import_row_logs_team_check;

UPDATE public.task_management_raw
SET team = CASE team WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' ELSE UPPER(team) END,
    discipline = CASE discipline WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' ELSE UPPER(discipline) END;

UPDATE public.task_management_import_logs SET discipline = CASE discipline WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' ELSE UPPER(discipline) END WHERE discipline IS NOT NULL;
UPDATE public.task_management_import_row_logs SET discipline = CASE discipline WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' ELSE UPPER(discipline) END WHERE discipline IS NOT NULL;
UPDATE public.task_management_status_history SET discipline = CASE discipline WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' ELSE UPPER(discipline) END WHERE discipline IS NOT NULL;

UPDATE public.defect_category_team_map SET team = UPPER(team);
UPDATE public.abd_items_raw SET team = UPPER(team) WHERE team IS NOT NULL;
UPDATE public.abd_import_logs SET team = UPPER(team) WHERE team IS NOT NULL;
UPDATE public.defect_import_row_logs SET team = UPPER(team) WHERE team IS NOT NULL AND team <> UPPER(team);
UPDATE public.defect_status_history SET team = UPPER(team) WHERE team IS NOT NULL AND team <> UPPER(team);
