drop function if exists public.abd_items_by_numbers(text[]);

create or replace function public.abd_items_by_numbers(_nums text[])
returns table (
  abd_number text,
  latest_status text,
  latest_status_norm text,
  is_terminated boolean,
  active_round smallint,
  r1_submission_actual date, r2_submission_actual date, r3_submission_actual date,
  r1_dar_actual date, r2_dar_actual date, r3_dar_actual date,
  r1_response_result text, r2_response_result text, r3_response_result text,
  r1_draft_start_actual date, r2_draft_start_actual date, r3_draft_start_actual date,
  r1_draft_finish_actual date, r2_draft_finish_actual date, r3_draft_finish_actual date,
  r1_draft_start_plan date, r2_draft_start_plan date, r3_draft_start_plan date,
  r1_draft_finish_plan date, r2_draft_finish_plan date, r3_draft_finish_plan date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    abd_number, latest_status, latest_status_norm, is_terminated, active_round,
    r1_submission_actual, r2_submission_actual, r3_submission_actual,
    r1_dar_actual, r2_dar_actual, r3_dar_actual,
    r1_response_result, r2_response_result, r3_response_result,
    r1_draft_start_actual, r2_draft_start_actual, r3_draft_start_actual,
    r1_draft_finish_actual, r2_draft_finish_actual, r3_draft_finish_actual,
    r1_draft_start_plan, r2_draft_start_plan, r3_draft_start_plan,
    r1_draft_finish_plan, r2_draft_finish_plan, r3_draft_finish_plan
  from public.abd_items_raw
  where abd_number = any(_nums)
$$;

grant execute on function public.abd_items_by_numbers(text[]) to authenticated, service_role;