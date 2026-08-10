-- ══ WRT · SPL 임포트 로그 4표: FOR ALL 제거 → I/U/D 분리, rcl_grants 모듈 판정 ══
DROP POLICY IF EXISTS wrt_import_logs_write ON public.wrt_import_logs;
DROP POLICY IF EXISTS wrt_import_row_logs_write ON public.wrt_import_row_logs;
DROP POLICY IF EXISTS spl_import_logs_write ON public.spl_import_logs;
DROP POLICY IF EXISTS spl_import_row_logs_write ON public.spl_import_row_logs;

CREATE POLICY wil_insert ON public.wrt_import_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY wil_update ON public.wrt_import_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY wil_delete ON public.wrt_import_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

CREATE POLICY wirl_insert ON public.wrt_import_row_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY wirl_update ON public.wrt_import_row_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY wirl_delete ON public.wrt_import_row_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('WRT','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

CREATE POLICY sil_insert ON public.spl_import_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY sil_update ON public.spl_import_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY sil_delete ON public.spl_import_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

CREATE POLICY sirl_insert ON public.spl_import_row_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY sirl_update ON public.spl_import_row_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY sirl_delete ON public.spl_import_row_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','import') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

-- ══ WRT · SPL change_log: 본인 명의 AND 부모 행 범위 (NULL 갈래 = 모듈 write 판정) ══
DROP POLICY IF EXISTS wrt_change_log_insert ON public.wrt_change_log;
DROP POLICY IF EXISTS spl_change_log_insert ON public.spl_change_log;

CREATE POLICY wcl_insert ON public.wrt_change_log FOR INSERT TO authenticated
  WITH CHECK (
    changed_by = auth.uid() AND (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'WRT',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('WRT','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
    ));
CREATE POLICY wcl_update ON public.wrt_change_log FOR UPDATE TO authenticated
  USING (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'WRT',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('WRT','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  )
  WITH CHECK (
    changed_by = auth.uid() AND (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'WRT',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('WRT','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
    ));

CREATE POLICY scl_insert ON public.spl_change_log FOR INSERT TO authenticated
  WITH CHECK (
    changed_by = auth.uid() AND (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'SPL',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
    ));
CREATE POLICY scl_update ON public.spl_change_log FOR UPDATE TO authenticated
  USING (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'SPL',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  )
  WITH CHECK (
    changed_by = auth.uid() AND (
      (item_id IS NOT NULL AND public.rcl_can(auth.uid(),'SPL',item_id,'write'))
      OR (item_id IS NULL AND EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
        WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
    ));