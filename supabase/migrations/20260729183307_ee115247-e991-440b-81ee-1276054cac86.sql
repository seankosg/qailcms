CREATE OR REPLACE FUNCTION public.abd_stage_group(_row public.abd_items_raw)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(_row.is_terminated,false) THEN 'RESUBMIT'
    WHEN coalesce(_row.bucket_top,'') = 'Approved' OR upper(btrim(coalesce(_row.latest_status,''))) = 'A' THEN 'APPROVED'
    WHEN _row.r1_draft_start_actual IS NULL AND _row.r1_draft_finish_actual IS NULL
         AND _row.r1_submission_actual IS NULL THEN 'NS'
    ELSE left(coalesce(_row.current_stage,'DS'), 2)
  END
$$;