-- 3-3 SM: defect_items_raw / defect_status_history / defect_import_logs / defect_import_row_logs
-- + 3-2 잔여 SELECT 완전중복 정리(TM 3표)

-- SELECT 완전중복 정리 (둘 다 USING (true)) — 하나만 남긴다
DROP POLICY IF EXISTS "tmsh read authenticated" ON public.task_management_status_history;
DROP POLICY IF EXISTS "tmil read authenticated" ON public.task_management_import_logs;
DROP POLICY IF EXISTS "tm_row_logs read authenticated" ON public.task_management_import_row_logs;

-- ── defect_items_raw (행 범위, SM)
DROP POLICY IF EXISTS defect_raw_insert ON public.defect_items_raw;
DROP POLICY IF EXISTS defect_raw_update ON public.defect_items_raw;
DROP POLICY IF EXISTS defect_raw_delete ON public.defect_items_raw;

CREATE POLICY dir_insert ON public.defect_items_raw
FOR INSERT TO authenticated
WITH CHECK (
  public.rcl_can_values('SM', jsonb_build_object(
    'team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name
  ), 'write')
);

CREATE POLICY dir_update ON public.defect_items_raw
FOR UPDATE TO authenticated
USING (public.rcl_can(auth.uid(), 'SM', id, 'write'))
WITH CHECK (
  public.rcl_can_values('SM', jsonb_build_object(
    'team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name
  ), 'write')
);

CREATE POLICY dir_delete ON public.defect_items_raw
FOR DELETE TO authenticated
USING (public.rcl_can(auth.uid(), 'SM', id, 'delete'));

-- ── defect_status_history (부모 범위 상속, 부모 칸 = defect_raw_id)
DROP POLICY IF EXISTS defect_status_history_insert ON public.defect_status_history;
DROP POLICY IF EXISTS dsh_update ON public.defect_status_history;
DROP POLICY IF EXISTS dsh_delete ON public.defect_status_history;

CREATE POLICY dsh_insert ON public.defect_status_history
FOR INSERT TO authenticated
WITH CHECK (
  changed_by = auth.uid()
  AND public.rcl_can(auth.uid(), 'SM', defect_raw_id, 'write')
);

CREATE POLICY dsh_update ON public.defect_status_history
FOR UPDATE TO authenticated
USING (public.rcl_can(auth.uid(), 'SM', defect_raw_id, 'write'))
WITH CHECK (public.rcl_can(auth.uid(), 'SM', defect_raw_id, 'write'));

CREATE POLICY dsh_delete ON public.defect_status_history
FOR DELETE TO authenticated
USING (public.rcl_can(auth.uid(), 'SM', defect_raw_id, 'delete'));

-- ── defect_import_logs (모듈 판정)
DROP POLICY IF EXISTS defect_import_logs_insert ON public.defect_import_logs;
DROP POLICY IF EXISTS defect_import_logs_update ON public.defect_import_logs;
DROP POLICY IF EXISTS defect_import_logs_admin_delete ON public.defect_import_logs;

CREATE POLICY dil_insert ON public.defect_import_logs
FOR INSERT TO authenticated
WITH CHECK (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);

CREATE POLICY dil_update ON public.defect_import_logs
FOR UPDATE TO authenticated
USING (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
)
WITH CHECK (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);

CREATE POLICY dil_delete ON public.defect_import_logs
FOR DELETE TO authenticated
USING (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);

-- ── defect_import_row_logs (모듈 판정)
DROP POLICY IF EXISTS defect_import_row_logs_insert ON public.defect_import_row_logs;
DROP POLICY IF EXISTS defect_import_row_logs_admin_delete ON public.defect_import_row_logs;
DROP POLICY IF EXISTS drl_update ON public.defect_import_row_logs;

CREATE POLICY drl_insert ON public.defect_import_row_logs
FOR INSERT TO authenticated
WITH CHECK (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);

CREATE POLICY drl_update ON public.defect_import_row_logs
FOR UPDATE TO authenticated
USING (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
)
WITH CHECK (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);

CREATE POLICY drl_delete ON public.defect_import_row_logs
FOR DELETE TO authenticated
USING (
  (public.rcl_grants('SM','import') ->> 'role') IS NOT NULL
  AND (
    (public.rcl_grants('SM','import') ->> 'own')::boolean
    OR (public.rcl_grants('SM','import') ->> 'own_team')::boolean
    OR (public.rcl_grants('SM','import') ->> 'other_team')::boolean
  )
);
