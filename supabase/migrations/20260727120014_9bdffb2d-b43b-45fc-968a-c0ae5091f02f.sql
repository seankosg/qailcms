drop function if exists public.abd_items_by_numbers(text[]);

-- ---------------------------------------------------------------------------
-- 반환 계약: jsonb 단일 값 (배열). Data API 행 상한(1,000) 비적용.
-- 중복 abd_number 정책: 배열에 모두 포함. 호출자가 첫 건만 사용, 이후는 무시.
--   (현재 abd_items_raw 실측 중복 0건. 규칙만 명문화.)
-- 반환 필드는 Aconex 임포트 computePatch() 가 실제 참조하는 최소셋 26개.
-- ---------------------------------------------------------------------------
create or replace function public.abd_items_by_numbers(_nums text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'abd_number', abd_number,
        'latest_status', latest_status,
        'latest_status_norm', latest_status_norm,
        'is_terminated', is_terminated,
        'active_round', active_round,
        'r1_submission_actual', r1_submission_actual,
        'r2_submission_actual', r2_submission_actual,
        'r3_submission_actual', r3_submission_actual,
        'r1_dar_actual', r1_dar_actual,
        'r2_dar_actual', r2_dar_actual,
        'r3_dar_actual', r3_dar_actual,
        'r1_response_result', r1_response_result,
        'r2_response_result', r2_response_result,
        'r3_response_result', r3_response_result,
        'r1_draft_start_actual', r1_draft_start_actual,
        'r2_draft_start_actual', r2_draft_start_actual,
        'r3_draft_start_actual', r3_draft_start_actual,
        'r1_draft_finish_actual', r1_draft_finish_actual,
        'r2_draft_finish_actual', r2_draft_finish_actual,
        'r3_draft_finish_actual', r3_draft_finish_actual,
        'r1_draft_start_plan', r1_draft_start_plan,
        'r2_draft_start_plan', r2_draft_start_plan,
        'r3_draft_start_plan', r3_draft_start_plan,
        'r1_draft_finish_plan', r1_draft_finish_plan,
        'r2_draft_finish_plan', r2_draft_finish_plan,
        'r3_draft_finish_plan', r3_draft_finish_plan
      )
    ),
    '[]'::jsonb
  )
  from public.abd_items_raw
  where abd_number = any(_nums);
$$;

grant execute on function public.abd_items_by_numbers(text[]) to authenticated, service_role;