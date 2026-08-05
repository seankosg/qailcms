ALTER TABLE public.abd_ocs_comment_groups
  DROP CONSTRAINT IF EXISTS abd_ocs_comment_groups_resp_chk;

ALTER TABLE public.abd_ocs_comment_groups
  ADD CONSTRAINT abd_ocs_comment_groups_resp_chk
  CHECK (response_mapping_status = ANY (ARRAY[
    'mapped'::text,
    'inherited'::text,
    'unmapped'::text,
    'group_response_open_rejected'::text
  ]));