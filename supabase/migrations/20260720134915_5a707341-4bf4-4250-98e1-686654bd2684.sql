
DROP POLICY IF EXISTS defect_raw_insert ON public.defect_items_raw;
DROP POLICY IF EXISTS defect_raw_update ON public.defect_items_raw;

CREATE POLICY defect_raw_insert ON public.defect_items_raw
  FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]));

CREATE POLICY defect_raw_update ON public.defect_items_raw
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]));
