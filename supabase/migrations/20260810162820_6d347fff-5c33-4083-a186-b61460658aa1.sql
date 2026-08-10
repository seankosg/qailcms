DROP POLICY IF EXISTS "Admins can delete import field logs" ON public.import_field_logs;
DROP POLICY IF EXISTS "Upload owners or admins can insert import field logs" ON public.import_field_logs;

CREATE POLICY "ifl_insert" ON public.import_field_logs
FOR INSERT TO authenticated
WITH CHECK (
  import_field_logs.kind IN ('task_management','defect','abd','spl','wrt')
  AND EXISTS (
    SELECT 1 FROM public.rcl_grants(
      CASE import_field_logs.kind
        WHEN 'task_management' THEN 'TM'
        WHEN 'defect' THEN 'SM'
        WHEN 'abd' THEN 'ABD'
        WHEN 'spl' THEN 'SPL'
        WHEN 'wrt' THEN 'WRT'
      END, 'import') g(g)
    WHERE COALESCE((g.g ->> 'own')::boolean, false)
       OR COALESCE((g.g ->> 'own_team')::boolean, false)
       OR COALESCE((g.g ->> 'other_team')::boolean, false)
  )
);

CREATE POLICY "ifl_update" ON public.import_field_logs
FOR UPDATE TO authenticated
USING (
  import_field_logs.kind IN ('task_management','defect','abd','spl','wrt')
  AND EXISTS (
    SELECT 1 FROM public.rcl_grants(
      CASE import_field_logs.kind
        WHEN 'task_management' THEN 'TM'
        WHEN 'defect' THEN 'SM'
        WHEN 'abd' THEN 'ABD'
        WHEN 'spl' THEN 'SPL'
        WHEN 'wrt' THEN 'WRT'
      END, 'import') g(g)
    WHERE COALESCE((g.g ->> 'own')::boolean, false)
       OR COALESCE((g.g ->> 'own_team')::boolean, false)
       OR COALESCE((g.g ->> 'other_team')::boolean, false)
  )
)
WITH CHECK (
  import_field_logs.kind IN ('task_management','defect','abd','spl','wrt')
  AND EXISTS (
    SELECT 1 FROM public.rcl_grants(
      CASE import_field_logs.kind
        WHEN 'task_management' THEN 'TM'
        WHEN 'defect' THEN 'SM'
        WHEN 'abd' THEN 'ABD'
        WHEN 'spl' THEN 'SPL'
        WHEN 'wrt' THEN 'WRT'
      END, 'import') g(g)
    WHERE COALESCE((g.g ->> 'own')::boolean, false)
       OR COALESCE((g.g ->> 'own_team')::boolean, false)
       OR COALESCE((g.g ->> 'other_team')::boolean, false)
  )
);

CREATE POLICY "ifl_delete" ON public.import_field_logs
FOR DELETE TO authenticated
USING (
  import_field_logs.kind IN ('task_management','defect','abd','spl','wrt')
  AND EXISTS (
    SELECT 1 FROM public.rcl_grants(
      CASE import_field_logs.kind
        WHEN 'task_management' THEN 'TM'
        WHEN 'defect' THEN 'SM'
        WHEN 'abd' THEN 'ABD'
        WHEN 'spl' THEN 'SPL'
        WHEN 'wrt' THEN 'WRT'
      END, 'import') g(g)
    WHERE COALESCE((g.g ->> 'own')::boolean, false)
       OR COALESCE((g.g ->> 'own_team')::boolean, false)
       OR COALESCE((g.g ->> 'other_team')::boolean, false)
  )
);