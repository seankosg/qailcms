-- 1) 내부 검증 함수: 권한 검사 없음, 읽기 전용
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_verify_internal()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'comments_total', (SELECT count(*) FROM abd_ocs_comments),
    'comments_active', (SELECT count(*) FROM abd_ocs_comments WHERE is_active),
    'comments_inactive', (SELECT count(*) FROM abd_ocs_comments WHERE NOT is_active),
    'superseded_parents', (SELECT count(*) FROM abd_ocs_comments WHERE retired_reason LIKE 'superseded_by_atomic_%'),
    'superseded_v3', (SELECT count(*) FROM abd_ocs_comments WHERE retired_reason='superseded_by_atomic_v3'),
    'active_linked', (SELECT count(*) FROM abd_ocs_comments WHERE is_active AND link_status='linked' AND abd_item_id IS NOT NULL),
    'active_unmatched', (SELECT count(*) FROM abd_ocs_comments WHERE is_active AND (link_status IS DISTINCT FROM 'linked' OR abd_item_id IS NULL)),
    'linked_multi', (SELECT count(*) FROM (
        SELECT l.comment_id FROM abd_ocs_comment_abd_links l
          JOIN abd_ocs_comments c ON c.id=l.comment_id
         WHERE c.is_active GROUP BY l.comment_id HAVING count(*) > 1) m),
    'distinct_linked_abd', (SELECT count(DISTINCT l.abd_item_id) FROM abd_ocs_comment_abd_links l JOIN abd_ocs_comments c ON c.id=l.comment_id WHERE c.is_active),
    'abd_link_associations', (SELECT count(*) FROM abd_ocs_comment_abd_links l JOIN abd_ocs_comments c ON c.id=l.comment_id WHERE c.is_active),
    'groups_total', (SELECT count(*) FROM abd_ocs_comment_groups),
    'groups_unmapped', (SELECT count(*) FROM abd_ocs_comment_groups WHERE response_mapping_status='unmapped'),
    'groups_inherited', (SELECT count(*) FROM abd_ocs_comment_groups WHERE response_mapping_status='inherited'),
    'groups_open_rejected', (SELECT count(*) FROM abd_ocs_comment_groups WHERE response_mapping_status='group_response_open_rejected'),
    'attachment_link_rows', (SELECT count(*) FROM abd_ocs_attachment_comment_links),
    'attachment_dup_pairs', (SELECT count(*) FROM (
        SELECT attachment_id, comment_id FROM abd_ocs_attachment_comment_links
         GROUP BY 1,2 HAVING count(*) > 1) d),
    'attachments_unresolved', (SELECT count(*) FROM abd_ocs_attachments a
        WHERE NOT EXISTS (SELECT 1 FROM abd_ocs_attachment_comment_links l WHERE l.attachment_id = a.id)),
    'attachment_metrics', public.abd_ocs_v3_attachment_metrics(),
    'response_segments', (SELECT count(*) FROM abd_ocs_response_segments),
    'response_links', (SELECT count(*) FROM abd_ocs_response_comment_links),
    'response_open_unlinked_segments', (SELECT count(*) FROM abd_ocs_response_segments s
        WHERE NOT EXISTS (SELECT 1 FROM abd_ocs_response_comment_links l WHERE l.response_segment_id = s.id)),
    'response_open_unlinked_groups', (SELECT count(DISTINCT s.comment_group_id) FROM abd_ocs_response_segments s
        WHERE NOT EXISTS (SELECT 1 FROM abd_ocs_response_comment_links l WHERE l.response_segment_id = s.id)),
    'compliance_rows', (SELECT count(*) FROM abd_ocs_compliance),
    'compliance_user_rows', (SELECT count(*) FROM abd_ocs_compliance WHERE source='user'),
    'compliance_log_rows', (SELECT count(*) FROM abd_ocs_compliance_log),
    'compliance_user_lost', (SELECT count(*) FROM (
        SELECT DISTINCT ON (lg.comment_id) lg.comment_id, lg.new_complied
          FROM abd_ocs_compliance_log lg
         WHERE lg.source='user'
         ORDER BY lg.comment_id, lg.changed_at DESC) last_user
       WHERE coalesce(last_user.new_complied,false)
         AND NOT EXISTS (SELECT 1 FROM abd_ocs_compliance cp
                          WHERE cp.comment_id = last_user.comment_id AND coalesce(cp.complied,false))),
    'cache_ocs_total', (SELECT coalesce(sum(ocs_total),0) FROM abd_items_raw),
    'cache_ocs_complied', (SELECT coalesce(sum(ocs_complied),0) FROM abd_items_raw),
    'canonical_ocs_total', (SELECT count(*) FROM abd_ocs_comments c
        WHERE c.is_active AND c.link_status='linked' AND c.abd_item_id IS NOT NULL),
    'canonical_ocs_complied', (SELECT count(*) FROM abd_ocs_comments c
        JOIN abd_ocs_compliance cp ON cp.comment_id = c.id
       WHERE c.is_active AND c.link_status='linked' AND c.abd_item_id IS NOT NULL AND coalesce(cp.complied,false)),
    'source_files', (SELECT count(*) FROM abd_ocs_source_files),
    'attachments_total', (SELECT count(*) FROM abd_ocs_attachments)
  ) INTO v;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.abd_ocs_v3_verify_internal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abd_ocs_v3_verify_internal() FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_v3_verify_internal() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_v3_verify_internal() TO service_role;

-- 2) 기존 admin-only 함수는 유지하되 계산은 내부 함수에 위임
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_verify()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'abd_ocs_v3_verify: admin only';
  END IF;
  RETURN public.abd_ocs_v3_verify_internal();
END;
$function$;