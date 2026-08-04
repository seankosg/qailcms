-- ══════════════════════════════════════════════════════════════
-- 되돌리기 스크립트 — WRT · SPL 임포트 개방 라운드 (2026-08-04)
-- ※ 이 파일은 자동 실행되지 않는다. 문제 발생 시 수동으로 실행할 것.
-- ══════════════════════════════════════════════════════════════

-- 1) RLS: RCL 판정 → 기존 관리자 계열 판정으로 복귀
DROP POLICY IF EXISTS wrt_items_insert ON public.wrt_items;
DROP POLICY IF EXISTS wrt_items_update ON public.wrt_items;
DROP POLICY IF EXISTS wrt_items_delete ON public.wrt_items;
DROP POLICY IF EXISTS wrt_progress_insert ON public.wrt_stage_progress;
DROP POLICY IF EXISTS wrt_progress_update ON public.wrt_stage_progress;
DROP POLICY IF EXISTS wrt_progress_delete ON public.wrt_stage_progress;
DROP POLICY IF EXISTS spl_items_insert ON public.spl_items;
DROP POLICY IF EXISTS spl_items_update ON public.spl_items;
DROP POLICY IF EXISTS spl_items_delete ON public.spl_items;
DROP POLICY IF EXISTS spl_progress_insert ON public.spl_stage_progress;
DROP POLICY IF EXISTS spl_progress_update ON public.spl_stage_progress;
DROP POLICY IF EXISTS spl_progress_delete ON public.spl_stage_progress;

CREATE POLICY wrt_items_write ON public.wrt_items FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]));
CREATE POLICY wrt_progress_write ON public.wrt_stage_progress FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]));
CREATE POLICY spl_items_write ON public.spl_items FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]));
CREATE POLICY spl_progress_write ON public.spl_stage_progress FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::public.app_role[]));

-- 2) SPL owner_cols 축소 (pic_po / eng_po 제거)
UPDATE public.rcl_module_config SET owner_cols = ARRAY['pic','eng'] WHERE module = 'SPL';

-- 3) SPL 담당자 자동 연결 트리거 함수 원복 (pic → eng)
CREATE OR REPLACE FUNCTION public.spl_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'')
     AND COALESCE(NEW.eng,'') = COALESCE(OLD.eng,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.pic,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.eng,'')), ''))
  );
  RETURN NEW;
END $$;

-- 4) 담당자 연결 스냅샷 복원 (필요 시에만)
-- UPDATE public.spl_items i
--    SET owner_user_id = s.owner_user_id
--   FROM public.spl_owner_backfill_snapshot_20260804 s
--  WHERE s.id = i.id AND i.owner_user_id IS DISTINCT FROM s.owner_user_id;