SET session_replication_role = 'replica';

UPDATE public.abd_items_raw SET
  r1_draft_finish_plan   = COALESCE(r1_draft_finish_plan,   r1_drafting_plan),
  r1_draft_finish_actual = COALESCE(r1_draft_finish_actual, r1_drafting_actual),
  r2_draft_finish_plan   = COALESCE(r2_draft_finish_plan,   r2_drafting_plan),
  r2_draft_finish_actual = COALESCE(r2_draft_finish_actual, r2_drafting_actual),
  r3_draft_finish_plan   = COALESCE(r3_draft_finish_plan,   r3_drafting_plan),
  r3_draft_finish_actual = COALESCE(r3_draft_finish_actual, r3_drafting_actual)
WHERE
  r1_drafting_plan IS NOT NULL OR r1_drafting_actual IS NOT NULL OR
  r2_drafting_plan IS NOT NULL OR r2_drafting_actual IS NOT NULL OR
  r3_drafting_plan IS NOT NULL OR r3_drafting_actual IS NOT NULL;

SET session_replication_role = 'origin';

-- 파생 필드 재계산 (needs_planning, current_stage 등)
UPDATE public.abd_items_raw SET updated_at = updated_at
WHERE r1_draft_finish_plan IS NOT NULL OR r1_draft_finish_actual IS NOT NULL
   OR r2_draft_finish_plan IS NOT NULL OR r2_draft_finish_actual IS NOT NULL
   OR r3_draft_finish_plan IS NOT NULL OR r3_draft_finish_actual IS NOT NULL;