DROP POLICY IF EXISTS "admin manage hdec_pic_name_master" ON public.hdec_pic_name_master;
CREATE POLICY "admin manage hdec_pic_name_master" ON public.hdec_pic_name_master
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'system_administrator'::app_role]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'system_administrator'::app_role]));