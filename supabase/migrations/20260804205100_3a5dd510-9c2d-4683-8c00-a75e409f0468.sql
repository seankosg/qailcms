-- ─────────────────────────────────────────────────────────────
-- C. WRT · SPL RLS → RCL 정본 판정으로 교체
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS wrt_items_write ON public.wrt_items;
DROP POLICY IF EXISTS wrt_progress_write ON public.wrt_stage_progress;
DROP POLICY IF EXISTS spl_items_write ON public.spl_items;
DROP POLICY IF EXISTS spl_progress_write ON public.spl_stage_progress;

-- WRT items
CREATE POLICY wrt_items_insert ON public.wrt_items FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can_values('WRT', jsonb_build_object('team', team, 'pic', pic, 'eng', eng), 'write'));
CREATE POLICY wrt_items_update ON public.wrt_items FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'WRT', id, 'write'))
  WITH CHECK (public.rcl_can_values('WRT', jsonb_build_object('team', team, 'pic', pic, 'eng', eng), 'write'));
CREATE POLICY wrt_items_delete ON public.wrt_items FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'WRT', id, 'delete'));

-- WRT stage progress (부모 아이템 범위를 그대로 상속)
CREATE POLICY wrt_progress_insert ON public.wrt_stage_progress FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can(auth.uid(), 'WRT', item_id, 'write'));
CREATE POLICY wrt_progress_update ON public.wrt_stage_progress FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'WRT', item_id, 'write'))
  WITH CHECK (public.rcl_can(auth.uid(), 'WRT', item_id, 'write'));
CREATE POLICY wrt_progress_delete ON public.wrt_stage_progress FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'WRT', item_id, 'delete'));

-- SPL items (owner_cols 확장 반영: pic, eng, pic_po, eng_po)
CREATE POLICY spl_items_insert ON public.spl_items FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can_values('SPL', jsonb_build_object('team', team, 'pic', pic, 'eng', eng, 'pic_po', pic_po, 'eng_po', eng_po), 'write'));
CREATE POLICY spl_items_update ON public.spl_items FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'SPL', id, 'write'))
  WITH CHECK (public.rcl_can_values('SPL', jsonb_build_object('team', team, 'pic', pic, 'eng', eng, 'pic_po', pic_po, 'eng_po', eng_po), 'write'));
CREATE POLICY spl_items_delete ON public.spl_items FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'SPL', id, 'delete'));

CREATE POLICY spl_progress_insert ON public.spl_stage_progress FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can(auth.uid(), 'SPL', item_id, 'write'));
CREATE POLICY spl_progress_update ON public.spl_stage_progress FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'SPL', item_id, 'write'))
  WITH CHECK (public.rcl_can(auth.uid(), 'SPL', item_id, 'write'));
CREATE POLICY spl_progress_delete ON public.spl_stage_progress FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'SPL', item_id, 'delete'));

-- ─────────────────────────────────────────────────────────────
-- D. SPL 담당자 자동 연결 — pic_po / eng_po 추가
--    우선순위: pic → eng → pic_po → eng_po
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spl_auto_owner_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'')
     AND COALESCE(NEW.eng,'') = COALESCE(OLD.eng,'')
     AND COALESCE(NEW.pic_po,'') = COALESCE(OLD.pic_po,'')
     AND COALESCE(NEW.eng_po,'') = COALESCE(OLD.eng_po,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.pic,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.eng,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.pic_po,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.eng_po,'')), ''))
  );
  RETURN NEW;
END
$$;