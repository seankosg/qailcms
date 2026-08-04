CREATE OR REPLACE FUNCTION public.abd_ocs_v2_dryrun_comments(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH r AS (
    SELECT x->>'source_comment_id' AS sid,
           x->>'source_parent_comment_id' AS pid,
           x->>'group_key' AS gkey,
           NULLIF(x->>'atomic_item_no','')::int AS item_no
    FROM jsonb_array_elements(p_rows) x
  ), j AS (
    SELECT r.*,
           p.id AS parent_id,
           p.abd_item_id AS parent_abd_item_id,
           p.link_status AS parent_link_status,
           e.id AS existing_id,
           cp.complied AS parent_user_complied,
           cp.source AS parent_compliance_source
    FROM r
    LEFT JOIN public.abd_ocs_comments p ON p.source_comment_id = r.pid
    LEFT JOIN public.abd_ocs_comments e ON e.source_comment_id = r.sid
    LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = p.id
  )
  SELECT jsonb_build_object(
    'rows', count(*),
    'parent_found', count(*) FILTER (WHERE parent_id IS NOT NULL),
    'parent_missing', count(*) FILTER (WHERE parent_id IS NULL),
    'atomic_new', count(*) FILTER (WHERE existing_id IS NULL),
    'atomic_existing', count(*) FILTER (WHERE existing_id IS NOT NULL),
    'inherit_linked', count(*) FILTER (WHERE parent_link_status = 'linked' AND parent_abd_item_id IS NOT NULL),
    'inherit_unlinked', count(*) FILTER (WHERE parent_id IS NOT NULL AND (parent_link_status IS DISTINCT FROM 'linked' OR parent_abd_item_id IS NULL)),
    'missing_item_no', count(*) FILTER (WHERE item_no IS NULL),
    -- 전역 DISTINCT 는 클라이언트에서 Set union 하도록 ID 목록으로 반환한다.
    'parent_ids', COALESCE((SELECT jsonb_agg(DISTINCT pid) FROM j WHERE pid IS NOT NULL), '[]'::jsonb),
    'group_keys', COALESCE((SELECT jsonb_agg(DISTINCT gkey) FROM j WHERE gkey IS NOT NULL), '[]'::jsonb),
    'abd_item_ids', COALESCE((SELECT jsonb_agg(DISTINCT parent_abd_item_id) FROM j WHERE parent_abd_item_id IS NOT NULL), '[]'::jsonb),
    'split_user_check_pids', COALESCE((SELECT jsonb_agg(DISTINCT pid) FROM j WHERE parent_compliance_source = 'user' AND parent_user_complied AND pid IS DISTINCT FROM sid), '[]'::jsonb),
    'user_row_pids', COALESCE((SELECT jsonb_agg(DISTINCT pid) FROM j WHERE parent_compliance_source = 'user' AND pid IS DISTINCT FROM sid), '[]'::jsonb),
    'missing_parent_ids', COALESCE((SELECT jsonb_agg(DISTINCT pid) FROM j WHERE parent_id IS NULL AND pid IS NOT NULL), '[]'::jsonb)
  ) INTO v_res FROM j;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_dryrun_attachments(p_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH j AS (
    SELECT s.sid, a.id AS att_id
    FROM unnest(p_ids) s(sid)
    LEFT JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.sid
  )
  SELECT jsonb_build_object(
    'ids', cardinality(p_ids),
    'resolved_ids', COALESCE((SELECT jsonb_agg(DISTINCT sid) FROM j WHERE att_id IS NOT NULL), '[]'::jsonb),
    'unresolved_ids', COALESCE((SELECT jsonb_agg(DISTINCT sid) FROM j WHERE att_id IS NULL), '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;