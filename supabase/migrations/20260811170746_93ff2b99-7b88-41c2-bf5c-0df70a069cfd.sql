DROP POLICY IF EXISTS tmr_update ON public.task_management_raw;
CREATE POLICY tmr_update ON public.task_management_raw
FOR UPDATE TO authenticated
USING (
  rcl_can(auth.uid(), 'TM'::text, id, 'write'::text)
  OR public.tm_is_delegate(auth.uid(), id)
)
WITH CHECK (
  rcl_can_values('TM'::text, jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name), 'write'::text)
  OR public.tm_is_delegate(auth.uid(), id)
);

DROP POLICY IF EXISTS tmsh_insert ON public.task_management_status_history;
CREATE POLICY tmsh_insert ON public.task_management_status_history
FOR INSERT TO authenticated
WITH CHECK (
  rcl_can(auth.uid(), 'TM'::text, task_raw_id, 'write'::text)
  OR public.tm_is_delegate(auth.uid(), task_raw_id)
);