-- Stage 1: 백업 목록 정본에 abd_ocs_comment_abd_links 추가 + 영구 OCS 테이블 누락 런타임 검증
CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    'abd_items_raw','defect_items_raw','task_management_raw','dmr_entries',
    'profiles','user_roles','team_master','subcontractor_master','dmr_contractor_master',
    'dmr_system_master','defect_category_team_map',
    'task_management_settings','abd_field_config','defect_field_config','task_management_field_config',
    'abd_header_mappings','defect_header_mappings','task_management_header_mappings',
    'abd_import_logs','defect_import_logs','task_management_import_logs','task_schedule_change_audit',
    'abd_settings','abd_import_presets','abd_comments','abd_change_log',
    'spl_items','spl_stage_catalog','spl_stage_progress','spl_change_log','spl_settings','spl_import_logs',
    'wrt_items','wrt_stage_catalog','wrt_stage_progress','wrt_change_log','wrt_settings','wrt_import_logs',
    'rcl_permissions','rcl_module_config','rcl_permissions_audit','rcl_module_config_audit',
    'hdec_eng_name_master','hdec_pic_name_master','hdec_name_propagation_log',
    'user_view_preferences','tm_alarm_settings','tm_milestone_config','tm_milestone_config_audit',
    'tm_milestone_kinds','defect_hdec_pic_rules','defect_subcon_rules','defect_import_presets',
    'task_comments','defect_comments','defect_status_history','task_management_status_history',
    'abd_ocs_import_logs','abd_ocs_comments','abd_ocs_comment_groups','abd_ocs_comment_abd_links',
    'abd_ocs_compliance','abd_ocs_attachments','abd_ocs_attachment_comment_links','abd_ocs_compliance_log',
    'abd_ocs_response_segments','abd_ocs_response_comment_links','abd_ocs_source_files',
    'abd_ocs_number_correction_log'
  ]::text[];
  v_missing text[];
BEGIN
  -- 영구 abd_ocs_% 테이블(스테이징 abd_ocs_v3_stage_% 제외)이 목록에서 빠지면 조용히 진행하지 않는다.
  SELECT coalesce(array_agg(t.table_name ORDER BY t.table_name), '{}')
    INTO v_missing
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name LIKE 'abd_ocs_%'
    AND t.table_name NOT LIKE 'abd_ocs_v3_stage_%'
    AND NOT (t.table_name = ANY (v_tables));

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'backup table list is missing permanent OCS tables: %', array_to_string(v_missing, ', ');
  END IF;

  RETURN v_tables;
END
$function$;

-- Stage 3: 레거시 finalize 는 현재 정본(atomic) 코멘트를 비활성화할 수 없다.
CREATE OR REPLACE FUNCTION public.abd_ocs_finalize_comments(p_source_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  n int;
  v_blocked int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  SELECT count(*) INTO v_blocked
  FROM public.abd_ocs_comments c
  WHERE c.is_active = true
    AND NOT (c.source_comment_id = ANY (p_source_ids))
    AND (coalesce(c.split_status, '') = 'atomic' OR c.comment_group_id IS NOT NULL);

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'legacy finalize blocked: % active atomic comment(s) would be deactivated', v_blocked;
  END IF;

  UPDATE public.abd_ocs_comments
     SET is_active = false, inactive_at = now(), retired_reason = 'absent_in_source', updated_at = now()
   WHERE is_active = true
     AND NOT (source_comment_id = ANY (p_source_ids))
     AND coalesce(split_status, '') <> 'atomic'
     AND comment_group_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('inactivated', n);
END
$function$;