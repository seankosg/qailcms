CREATE OR REPLACE FUNCTION public.abd_ocs_v3_dryrun(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'stage_run_id', p_run,
    'physical_atomic', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run),
    'inactive_blank', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND NOT is_active),
    'active_atomic', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active),
    'linked', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active AND link_status='linked'),
    'linked_multi', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active AND link_status='linked_multi'),
    'active_unmatched', (SELECT count(*) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active AND COALESCE(link_status,'') NOT IN ('linked','linked_multi')),
    'abd_link_associations', (SELECT COALESCE(sum(cardinality(abd_numbers)),0) FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active),
    'distinct_linked_abd', (SELECT count(*) FROM (SELECT DISTINCT unnest(abd_numbers) n FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active) q),
    'distinct_abd_resolved', (SELECT count(*) FROM (SELECT DISTINCT unnest(abd_numbers) n FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active) q JOIN abd_items_raw r ON r.abd_number=q.n),
    'abd_numbers_unresolved', (SELECT count(*) FROM (SELECT DISTINCT unnest(abd_numbers) n FROM abd_ocs_v3_stage_comments WHERE stage_run_id=p_run AND is_active) q WHERE NOT EXISTS (SELECT 1 FROM abd_items_raw r WHERE r.abd_number=q.n)),
    'missing_parent', (SELECT count(DISTINCT s.source_parent_comment_id) FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND NOT EXISTS (SELECT 1 FROM abd_ocs_comments c WHERE c.source_comment_id=s.source_parent_comment_id)),
    'duplicate_active_atomic_id', 0,
    'comments_to_insert', (SELECT count(*) FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND NOT EXISTS (SELECT 1 FROM abd_ocs_comments c WHERE c.source_comment_id=s.source_comment_id)),
    'comments_to_update', (SELECT count(*) FROM abd_ocs_v3_stage_comments s JOIN abd_ocs_comments c ON c.source_comment_id=s.source_comment_id WHERE s.stage_run_id=p_run),
    'v2_parents_to_supersede', (SELECT count(*) FROM abd_ocs_comments c WHERE c.is_active AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND s.source_comment_id=c.source_comment_id) AND EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=p_run AND s2.source_parent_comment_id=c.source_comment_id)),
    'v2_active_orphans', (SELECT count(*) FROM abd_ocs_comments c WHERE c.is_active AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND s.source_comment_id=c.source_comment_id) AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=p_run AND s2.source_parent_comment_id=c.source_comment_id)),
    'staged_attachments', (SELECT count(*) FROM abd_ocs_v3_stage_attachments WHERE stage_run_id=p_run),
    'unresolved_attachments', (SELECT count(*) FROM abd_ocs_v3_stage_attachments s WHERE s.stage_run_id=p_run AND NOT EXISTS (SELECT 1 FROM abd_ocs_attachments a WHERE a.source_attachment_id=s.attachment_id)),
    'duplicate_attachment_comment_pairs', (SELECT count(*) FROM (SELECT attachment_id, atomic_comment_id FROM abd_ocs_v3_stage_attachments WHERE stage_run_id=p_run AND atomic_comment_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) q),
    'attachment_scope_group', (SELECT count(*) FROM abd_ocs_v3_stage_attachments WHERE stage_run_id=p_run AND attachment_scope='group'),
    'attachment_scope_single', (SELECT count(*) FROM abd_ocs_v3_stage_attachments WHERE stage_run_id=p_run AND attachment_scope='single'),
    'attachment_scope_needs_review', (SELECT count(*) FROM abd_ocs_v3_stage_attachments WHERE stage_run_id=p_run AND attachment_scope='needs_review'),
    'open_response_segments', (SELECT count(*) FROM abd_ocs_v3_stage_response WHERE stage_run_id=p_run AND mapping_status IN ('requires_review','probable')),
    'open_response_groups', (SELECT count(DISTINCT source_parent_comment_id) FROM abd_ocs_v3_stage_response WHERE stage_run_id=p_run AND mapping_status IN ('requires_review','probable')),
    'confirmed_high_segments', (SELECT count(*) FROM abd_ocs_v3_stage_response WHERE stage_run_id=p_run AND mapping_status='confirmed_high'),
    'remaining_decision_required', (SELECT count(*) FROM abd_ocs_v3_stage_response r WHERE r.stage_run_id=p_run AND r.mapping_status='confirmed_high' AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND s.source_comment_id=r.atomic_comment_id AND s.is_active)),
    'user_compliance_rows', (SELECT count(*) FROM abd_ocs_compliance WHERE source='user'),
    -- 교정: 이번 stage_run_id 증분 OCS scope 안의 기존 코멘트만 충돌로 집계
    'user_compliance_conflicts', (
      SELECT count(*) FROM abd_ocs_compliance cp
      JOIN abd_ocs_comments c ON c.id=cp.comment_id
      WHERE cp.source='user' AND cp.complied
        AND COALESCE(c.ocs_number_norm,'') IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s)
        AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=p_run AND (s2.source_comment_id=c.source_comment_id OR s2.source_parent_comment_id=c.source_comment_id))
    ),
    'user_compliance_true_to_carry', (SELECT count(*) FROM abd_ocs_compliance cp JOIN abd_ocs_comments c ON c.id=cp.comment_id WHERE cp.source='user' AND cp.complied AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND s.source_comment_id=c.source_comment_id) AND EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=p_run AND s2.source_parent_comment_id=c.source_comment_id AND s2.is_active)),
    'raw_data_ocs_corrections_after', (SELECT count(*) FROM abd_ocs_number_correction_log l JOIN abd_items_raw r ON r.abd_number=l.abd_number WHERE r.abd_ocs_no = l.ocs_after),
    'raw_data_ocs_corrections_total', (SELECT count(*) FROM abd_ocs_number_correction_log),
    'attachment_metrics', public.abd_ocs_v3_attachment_metrics()
  ) INTO v;
  RETURN v;
END $function$;