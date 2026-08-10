-- 1) task_management_status_history : 부모(task_raw_id) 행 범위 판정
DROP POLICY IF EXISTS "tmsh admin write" ON public.task_management_status_history;
DROP POLICY IF EXISTS "Admins delete task_management_status_history" ON public.task_management_status_history;
DROP POLICY IF EXISTS "User+ write task_management_status_history" ON public.task_management_status_history;
DROP POLICY IF EXISTS "User+ update task_management_status_history" ON public.task_management_status_history;
DROP POLICY IF EXISTS tmsh_insert ON public.task_management_status_history;
DROP POLICY IF EXISTS tmsh_update ON public.task_management_status_history;
DROP POLICY IF EXISTS tmsh_delete ON public.task_management_status_history;

CREATE POLICY tmsh_insert ON public.task_management_status_history
  FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can(auth.uid(), 'TM', task_raw_id, 'write'));

CREATE POLICY tmsh_update ON public.task_management_status_history
  FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TM', task_raw_id, 'write'))
  WITH CHECK (public.rcl_can(auth.uid(), 'TM', task_raw_id, 'write'));

CREATE POLICY tmsh_delete ON public.task_management_status_history
  FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TM', task_raw_id, 'delete'));

-- 2) task_management_import_logs : 모듈 판정
DROP POLICY IF EXISTS "tmil admin write" ON public.task_management_import_logs;
DROP POLICY IF EXISTS "Admins delete task_management_import_logs" ON public.task_management_import_logs;
DROP POLICY IF EXISTS "User+ write task_management_import_logs" ON public.task_management_import_logs;
DROP POLICY IF EXISTS "User+ update task_management_import_logs" ON public.task_management_import_logs;
DROP POLICY IF EXISTS tmil_insert ON public.task_management_import_logs;
DROP POLICY IF EXISTS tmil_update ON public.task_management_import_logs;
DROP POLICY IF EXISTS tmil_delete ON public.task_management_import_logs;

CREATE POLICY tmil_insert ON public.task_management_import_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tmil_update ON public.task_management_import_logs
  FOR UPDATE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  )
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tmil_delete ON public.task_management_import_logs
  FOR DELETE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

-- 3) task_management_import_row_logs : 모듈 판정
DROP POLICY IF EXISTS "Admins delete task_management_import_row_logs" ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS "tm_row_logs admin delete" ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS "User+ write task_management_import_row_logs" ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS "tm_row_logs admin write" ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS "User+ update task_management_import_row_logs" ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS tmrl_insert ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS tmrl_update ON public.task_management_import_row_logs;
DROP POLICY IF EXISTS tmrl_delete ON public.task_management_import_row_logs;

CREATE POLICY tmrl_insert ON public.task_management_import_row_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tmrl_update ON public.task_management_import_row_logs
  FOR UPDATE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  )
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tmrl_delete ON public.task_management_import_row_logs
  FOR DELETE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

-- 4) task_schedule_change_audit : 모듈 판정 (전 13,607행이 import_log_id 보유 → 임포트 유래)
DROP POLICY IF EXISTS "Admins can manage task schedule audit" ON public.task_schedule_change_audit;
DROP POLICY IF EXISTS "Authenticated can insert task schedule audit" ON public.task_schedule_change_audit;
DROP POLICY IF EXISTS tsca_insert ON public.task_schedule_change_audit;
DROP POLICY IF EXISTS tsca_update ON public.task_schedule_change_audit;
DROP POLICY IF EXISTS tsca_delete ON public.task_schedule_change_audit;

CREATE POLICY tsca_insert ON public.task_schedule_change_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tsca_update ON public.task_schedule_change_audit
  FOR UPDATE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  )
  WITH CHECK (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );

CREATE POLICY tsca_delete ON public.task_schedule_change_audit
  FOR DELETE TO authenticated
  USING (
    (public.rcl_grants('TM','import')->>'role') IS NOT NULL AND (
      (public.rcl_grants('TM','import')->>'own')::boolean
      OR (public.rcl_grants('TM','import')->>'own_team')::boolean
      OR (public.rcl_grants('TM','import')->>'other_team')::boolean
    )
  );