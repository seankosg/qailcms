
-- 재임포트에서 비즈니스 필드가 실제로 변하지 않은 UPDATE는 서버 단에서 스킵.
-- BEFORE UPDATE 트리거가 NULL을 반환하면 해당 UPDATE는 실행되지 않는다.
-- 결과: 대량 재임포트의 MVCC/WAL/인덱스/AFTER 트리거 부하가 크게 감소.
--
-- 비교에서 제외: id, created_at, updated_at, row_version, source_import_log_id,
--                data_date, updated_by, raw_payload (이 값들만 바뀌는 것은 기록용이므로 스킵)
--
-- 비교 대상: 비즈니스적으로 의미 있는 나머지 컬럼 전부.

CREATE OR REPLACE FUNCTION public.trg_defect_suppress_noop_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.team IS NOT DISTINCT FROM OLD.team
     AND NEW.source_issue_no IS NOT DISTINCT FROM OLD.source_issue_no
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.location_raw IS NOT DISTINCT FROM OLD.location_raw
     AND NEW.plan_title IS NOT DISTINCT FROM OLD.plan_title
     AND NEW.plan_group IS NOT DISTINCT FROM OLD.plan_group
     AND NEW.status_raw IS NOT DISTINCT FROM OLD.status_raw
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.defect_type IS NOT DISTINCT FROM OLD.defect_type
     AND NEW.item IS NOT DISTINCT FROM OLD.item
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.priority IS NOT DISTINCT FROM OLD.priority
     AND NEW.due_by IS NOT DISTINCT FROM OLD.due_by
     AND NEW.created_by_name IS NOT DISTINCT FROM OLD.created_by_name
     AND NEW.created_by_team_name IS NOT DISTINCT FROM OLD.created_by_team_name
     AND NEW.created_date IS NOT DISTINCT FROM OLD.created_date
     AND NEW.ir IS NOT DISTINCT FROM OLD.ir
     AND NEW.forms IS NOT DISTINCT FROM OLD.forms
     AND NEW.last_updated_at IS NOT DISTINCT FROM OLD.last_updated_at
     AND NEW.updated_description IS NOT DISTINCT FROM OLD.updated_description
     AND NEW.updated_by_name IS NOT DISTINCT FROM OLD.updated_by_name
     AND NEW.updated_status IS NOT DISTINCT FROM OLD.updated_status
     AND NEW.updated_date_raw IS NOT DISTINCT FROM OLD.updated_date_raw
     AND NEW.location_reference IS NOT DISTINCT FROM OLD.location_reference
     AND NEW.classification IS NOT DISTINCT FROM OLD.classification
     AND NEW.podium_area IS NOT DISTINCT FROM OLD.podium_area
     AND NEW.issue_no IS NOT DISTINCT FROM OLD.issue_no
     AND NEW.subcontractor_issue_no IS NOT DISTINCT FROM OLD.subcontractor_issue_no
     AND NEW.subcontractor_issue_source IS NOT DISTINCT FROM OLD.subcontractor_issue_source
     AND NEW.main_trade IS NOT DISTINCT FROM OLD.main_trade
     AND NEW.sub_trade IS NOT DISTINCT FROM OLD.sub_trade
     AND NEW.trade_detail IS NOT DISTINCT FROM OLD.trade_detail
     AND NEW.area_type IS NOT DISTINCT FROM OLD.area_type
     AND NEW.area_level IS NOT DISTINCT FROM OLD.area_level
     AND NEW.area_location IS NOT DISTINCT FROM OLD.area_location
     AND NEW.subcontractor_name IS NOT DISTINCT FROM OLD.subcontractor_name
     AND NEW.subsub_name IS NOT DISTINCT FROM OLD.subsub_name
     AND NEW.hdec_pic_name IS NOT DISTINCT FROM OLD.hdec_pic_name
     AND NEW.hdec_eng_name IS NOT DISTINCT FROM OLD.hdec_eng_name
     AND NEW.captured_by_name IS NOT DISTINCT FROM OLD.captured_by_name
     AND NEW.work_type IS NOT DISTINCT FROM OLD.work_type
     AND NEW.classification_source IS NOT DISTINCT FROM OLD.classification_source
     AND NEW.classified_at IS NOT DISTINCT FROM OLD.classified_at
     AND NEW.planned_start_date IS NOT DISTINCT FROM OLD.planned_start_date
     AND NEW.planned_completion_date IS NOT DISTINCT FROM OLD.planned_completion_date
     AND NEW.planned_closure_date IS NOT DISTINCT FROM OLD.planned_closure_date
     AND NEW.actual_start_date IS NOT DISTINCT FROM OLD.actual_start_date
     AND NEW.actual_completion_date IS NOT DISTINCT FROM OLD.actual_completion_date
     AND NEW.actual_closure_date IS NOT DISTINCT FROM OLD.actual_closure_date
     AND NEW.planned_progress_pct IS NOT DISTINCT FROM OLD.planned_progress_pct
     AND NEW.actual_progress_pct IS NOT DISTINCT FROM OLD.actual_progress_pct
     AND NEW.completion_status IS NOT DISTINCT FROM OLD.completion_status
     AND NEW.closure_status IS NOT DISTINCT FROM OLD.closure_status
     AND NEW.status_manual IS NOT DISTINCT FROM OLD.status_manual
     AND NEW.hdec_verification IS NOT DISTINCT FROM OLD.hdec_verification
     AND NEW.hdec_reason IS NOT DISTINCT FROM OLD.hdec_reason
     AND NEW.hdec_comments IS NOT DISTINCT FROM OLD.hdec_comments
     AND NEW.aconex_comments IS NOT DISTINCT FROM OLD.aconex_comments
     AND NEW.remarks IS NOT DISTINCT FROM OLD.remarks
     AND NEW.priority_locked IS NOT DISTINCT FROM OLD.priority_locked
     AND NEW.hdec_verification_locked IS NOT DISTINCT FROM OLD.hdec_verification_locked
     AND NEW.is_critical IS NOT DISTINCT FROM OLD.is_critical
     AND NEW.status_group IS NOT DISTINCT FROM OLD.status_group
     AND NEW.building IS NOT DISTINCT FROM OLD.building
     AND NEW.room IS NOT DISTINCT FROM OLD.room
     AND NEW.room_group IS NOT DISTINCT FROM OLD.room_group
     AND NEW.level_name IS NOT DISTINCT FROM OLD.level_name
     AND NEW.review_flag IS NOT DISTINCT FROM OLD.review_flag
     AND NEW.custom_payload IS NOT DISTINCT FROM OLD.custom_payload
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 트리거 이름은 알파벳 순으로 다른 BEFORE UPDATE 트리거(defect_items_raw_set_updated_at)보다
-- 먼저 실행되도록 'aa_' 접두어를 사용한다.
DROP TRIGGER IF EXISTS aa_defect_items_raw_suppress_noop ON public.defect_items_raw;
CREATE TRIGGER aa_defect_items_raw_suppress_noop
BEFORE UPDATE ON public.defect_items_raw
FOR EACH ROW
EXECUTE FUNCTION public.trg_defect_suppress_noop_update();
