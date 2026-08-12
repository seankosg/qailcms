DROP POLICY IF EXISTS tm_pic_deleg_update ON public.tm_pic_delegations;
DROP POLICY IF EXISTS tm_pic_deleg_delete ON public.tm_pic_delegations;

CREATE POLICY tm_pic_deleg_update ON public.tm_pic_delegations
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'superuser'::app_role)
  OR has_role(auth.uid(), 'system_administrator'::app_role)
  OR created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = tm_pic_delegations.from_pic_norm)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'superuser'::app_role)
  OR has_role(auth.uid(), 'system_administrator'::app_role)
  OR created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = hdec_name_norm(tm_pic_delegations.from_pic))
);

CREATE POLICY tm_pic_deleg_delete ON public.tm_pic_delegations
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'superuser'::app_role)
  OR has_role(auth.uid(), 'system_administrator'::app_role)
  OR created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = tm_pic_delegations.from_pic_norm)
);