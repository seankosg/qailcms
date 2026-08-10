-- ===== abd_items_raw =====
DROP POLICY IF EXISTS abd_items_insert ON public.abd_items_raw;
DROP POLICY IF EXISTS abd_items_update ON public.abd_items_raw;
DROP POLICY IF EXISTS abd_items_admin_delete ON public.abd_items_raw;

CREATE POLICY air_insert ON public.abd_items_raw
FOR INSERT TO authenticated
WITH CHECK (
  public.rcl_can_values(
    'ABD',
    jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name),
    'write'
  )
);

CREATE POLICY air_update ON public.abd_items_raw
FOR UPDATE TO authenticated
USING (public.rcl_can(auth.uid(), 'ABD', id, 'write'))
WITH CHECK (
  public.rcl_can_values(
    'ABD',
    jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name),
    'write'
  )
);

CREATE POLICY air_delete ON public.abd_items_raw
FOR DELETE TO authenticated
USING (public.rcl_can(auth.uid(), 'ABD', id, 'delete'));

-- ===== abd_change_log =====
DROP POLICY IF EXISTS abd_change_log_insert ON public.abd_change_log;
DROP POLICY IF EXISTS abd_change_log_admin_delete ON public.abd_change_log;

CREATE POLICY acl_insert ON public.abd_change_log
FOR INSERT TO authenticated
WITH CHECK (
  changed_by = auth.uid()
  AND (
    (abd_item_id IS NOT NULL AND public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'write'))
    OR (abd_item_id IS NULL AND EXISTS (
      SELECT 1 FROM public.rcl_grants('ABD', 'write') g
      WHERE COALESCE((g->>'own')::boolean, false)
         OR COALESCE((g->>'own_team')::boolean, false)
         OR COALESCE((g->>'other_team')::boolean, false)
    ))
  )
);

CREATE POLICY acl_update ON public.abd_change_log
FOR UPDATE TO authenticated
USING (
  (abd_item_id IS NOT NULL AND public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'write'))
  OR (abd_item_id IS NULL AND EXISTS (
    SELECT 1 FROM public.rcl_grants('ABD', 'write') g
    WHERE COALESCE((g->>'own')::boolean, false)
       OR COALESCE((g->>'own_team')::boolean, false)
       OR COALESCE((g->>'other_team')::boolean, false)
  ))
)
WITH CHECK (
  changed_by = auth.uid()
  AND (
    (abd_item_id IS NOT NULL AND public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'write'))
    OR (abd_item_id IS NULL AND EXISTS (
      SELECT 1 FROM public.rcl_grants('ABD', 'write') g
      WHERE COALESCE((g->>'own')::boolean, false)
         OR COALESCE((g->>'own_team')::boolean, false)
         OR COALESCE((g->>'other_team')::boolean, false)
    ))
  )
);

CREATE POLICY acl_delete ON public.abd_change_log
FOR DELETE TO authenticated
USING (
  (abd_item_id IS NOT NULL AND public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'delete'))
  OR (abd_item_id IS NULL AND EXISTS (
    SELECT 1 FROM public.rcl_grants('ABD', 'delete') g
    WHERE COALESCE((g->>'own')::boolean, false)
       OR COALESCE((g->>'own_team')::boolean, false)
       OR COALESCE((g->>'other_team')::boolean, false)
  ))
);

-- ===== abd_import_logs =====
DROP POLICY IF EXISTS abd_import_logs_insert ON public.abd_import_logs;
DROP POLICY IF EXISTS abd_import_logs_update ON public.abd_import_logs;
DROP POLICY IF EXISTS abd_import_logs_admin_delete ON public.abd_import_logs;

CREATE POLICY ail_insert ON public.abd_import_logs
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));

CREATE POLICY ail_update ON public.abd_import_logs
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));

CREATE POLICY ail_delete ON public.abd_import_logs
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));

-- ===== abd_import_row_logs =====
DROP POLICY IF EXISTS abd_import_row_logs_insert ON public.abd_import_row_logs;
DROP POLICY IF EXISTS abd_import_row_logs_admin_delete ON public.abd_import_row_logs;

CREATE POLICY airl_insert ON public.abd_import_row_logs
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));

CREATE POLICY airl_update ON public.abd_import_row_logs
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));

CREATE POLICY airl_delete ON public.abd_import_row_logs
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rcl_grants('ABD', 'import') g
  WHERE COALESCE((g->>'own')::boolean, false)
     OR COALESCE((g->>'own_team')::boolean, false)
     OR COALESCE((g->>'other_team')::boolean, false)
));