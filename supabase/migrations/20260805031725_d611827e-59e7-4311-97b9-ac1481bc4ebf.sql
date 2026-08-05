
CREATE TABLE IF NOT EXISTS public.abd_ocs_response_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_parent_comment_id text NOT NULL,
  comment_group_id uuid REFERENCES public.abd_ocs_comment_groups(id) ON DELETE SET NULL,
  response_segment_no integer NOT NULL DEFAULT 1,
  response_source_label text,
  response_text text,
  source_file_name text,
  source_sheet text,
  source_row integer,
  source_hash text NOT NULL DEFAULT '',
  import_log_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abd_ocs_response_segments_uniq
    UNIQUE (source_parent_comment_id, response_segment_no, source_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_response_segments TO authenticated;
GRANT ALL ON public.abd_ocs_response_segments TO service_role;
ALTER TABLE public.abd_ocs_response_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resp_segments_read" ON public.abd_ocs_response_segments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resp_segments_admin_write" ON public.abd_ocs_response_segments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS abd_ocs_response_segments_parent_idx
  ON public.abd_ocs_response_segments(source_parent_comment_id);

CREATE TABLE IF NOT EXISTS public.abd_ocs_response_comment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_segment_id uuid NOT NULL REFERENCES public.abd_ocs_response_segments(id) ON DELETE CASCADE,
  atomic_comment_id uuid REFERENCES public.abd_ocs_comments(id) ON DELETE CASCADE,
  source_atomic_comment_id text,
  mapping_status text NOT NULL,
  mapping_method text,
  confidence_score numeric,
  evidence_terms jsonb,
  import_log_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abd_ocs_response_links_status_chk CHECK (
    mapping_status IN ('confirmed_high','probable','requires_review','duplicate_ignored','manual_confirmed','manual_rejected')
  ),
  CONSTRAINT abd_ocs_response_links_uniq UNIQUE (response_segment_id, atomic_comment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_response_comment_links TO authenticated;
GRANT ALL ON public.abd_ocs_response_comment_links TO service_role;
ALTER TABLE public.abd_ocs_response_comment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resp_links_read" ON public.abd_ocs_response_comment_links
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resp_links_admin_write" ON public.abd_ocs_response_comment_links
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS abd_ocs_response_links_comment_idx
  ON public.abd_ocs_response_comment_links(atomic_comment_id);

CREATE TRIGGER abd_ocs_response_segments_touch
  BEFORE UPDATE ON public.abd_ocs_response_segments
  FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();
CREATE TRIGGER abd_ocs_response_links_touch
  BEFORE UPDATE ON public.abd_ocs_response_comment_links
  FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
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
    'abd_ocs_import_logs','abd_ocs_comments','abd_ocs_comment_groups',
    'abd_ocs_compliance','abd_ocs_attachments','abd_ocs_attachment_comment_links','abd_ocs_compliance_log',
    'abd_ocs_response_segments','abd_ocs_response_comment_links'
  ]::text[]
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v3_dryrun_parents(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r jsonb; pid text; v3 jsonb; cid text; txt text; grp_id uuid;
  db_ids text[]; v3_ids text[]; changed boolean;
  parents int := 0; missing_parent int := 0;
  unchanged int := 0; updated int := 0; inserted int := 0; superseded int := 0;
  v2_active int := 0; changed_parents int := 0;
  linked_children int := 0; unmatched_children int := 0;
  comp_preserved int := 0; comp_at_risk_user_true int := 0; comp_user_false int := 0;
  comp_import_a_preserved int := 0; comp_import_a_at_risk int := 0; comp_log_rows int := 0;
  att_conf_preserved int := 0; att_conf_downgrade int := 0; att_group_atts int := 0;
  expected_complied int := 0; n int;
  missing_ids text[] := '{}'; conflict_ids text[] := '{}'; superseded_ids text[] := '{}';
  blocked_ids text[] := '{}'; abd_ids text[] := '{}'; changed_pids text[] := '{}';
  parent_ids text[] := '{}';
  is_linked boolean; abd_id uuid; comp_key text;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'p_rows must be a json array'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    pid := r->>'pid';
    IF pid IS NULL THEN CONTINUE; END IF;
    parents := parents + 1;
    parent_ids := parent_ids || pid;

    SELECT id INTO grp_id FROM abd_ocs_comment_groups WHERE source_parent_comment_id = pid;
    IF grp_id IS NULL THEN
      missing_parent := missing_parent + 1;
      missing_ids := missing_ids || pid;
    END IF;

    SELECT coalesce(array_agg(source_comment_id), '{}'), coalesce(bool_or(abd_item_id IS NOT NULL), false), max(abd_item_id)
      INTO db_ids, is_linked, abd_id
      FROM abd_ocs_comments WHERE source_parent_comment_id = pid AND is_active;
    v2_active := v2_active + coalesce(array_length(db_ids,1),0);
    IF abd_id IS NOT NULL THEN abd_ids := abd_ids || abd_id::text; END IF;

    v3_ids := '{}';
    changed := false;
    FOR v3 IN SELECT * FROM jsonb_array_elements(coalesce(r->'children','[]'::jsonb)) LOOP
      cid := v3->>'cid';
      IF cid IS NULL THEN CONTINUE; END IF;
      txt := btrim(coalesce(v3->>'txt',''));
      v3_ids := v3_ids || cid;
      IF is_linked THEN linked_children := linked_children + 1;
      ELSE unmatched_children := unmatched_children + 1; END IF;

      IF cid = ANY(db_ids) THEN
        IF EXISTS (SELECT 1 FROM abd_ocs_comments c
                   WHERE c.source_comment_id = cid AND c.is_active
                     AND btrim(coalesce(c.ocs_comment,'')) = txt) THEN
          unchanged := unchanged + 1;
        ELSE
          updated := updated + 1;
          conflict_ids := conflict_ids || cid;
          changed := true;
        END IF;
      ELSE
        inserted := inserted + 1;
        changed := true;
      END IF;
    END LOOP;

    FOREACH cid IN ARRAY db_ids LOOP
      IF NOT (cid = ANY(v3_ids)) THEN
        superseded := superseded + 1;
        superseded_ids := superseded_ids || cid;
        changed := true;
      END IF;
    END LOOP;

    IF changed THEN
      changed_parents := changed_parents + 1;
      changed_pids := changed_pids || pid;
    END IF;

    FOR cid, comp_key IN
      SELECT c.source_comment_id, comp.source || '|' || comp.complied::text
        FROM abd_ocs_comments c
        JOIN abd_ocs_compliance comp ON comp.comment_id = c.id
       WHERE c.source_parent_comment_id = pid AND c.is_active
    LOOP
      IF comp_key = 'user|true' THEN
        IF cid = ANY(conflict_ids) OR cid = ANY(superseded_ids) THEN
          comp_at_risk_user_true := comp_at_risk_user_true + 1;
          blocked_ids := blocked_ids || cid;
        ELSE
          comp_preserved := comp_preserved + 1;
          IF is_linked THEN expected_complied := expected_complied + 1; END IF;
        END IF;
      ELSIF comp_key = 'user|false' THEN
        comp_user_false := comp_user_false + 1;
        comp_preserved := comp_preserved + 1;
      ELSIF comp_key LIKE 'import_status_a|%' THEN
        IF cid = ANY(conflict_ids) OR cid = ANY(superseded_ids) THEN
          comp_import_a_at_risk := comp_import_a_at_risk + 1;
        ELSE
          comp_import_a_preserved := comp_import_a_preserved + 1;
          IF is_linked AND comp_key = 'import_status_a|true' THEN expected_complied := expected_complied + 1; END IF;
        END IF;
      END IF;
    END LOOP;

    SELECT count(*) INTO n
      FROM abd_ocs_compliance_log l
      JOIN abd_ocs_comments c ON c.id = l.comment_id
     WHERE c.source_parent_comment_id = pid;
    comp_log_rows := comp_log_rows + coalesce(n,0);

    FOR cid IN
      SELECT DISTINCT c.source_comment_id
        FROM abd_ocs_attachment_comment_links l
        JOIN abd_ocs_comments c ON c.id = l.comment_id
       WHERE c.source_parent_comment_id = pid AND l.mapping_status = 'confirmed'
    LOOP
      IF cid = ANY(conflict_ids) OR cid = ANY(superseded_ids) THEN
        att_conf_downgrade := att_conf_downgrade + 1;
      ELSE
        att_conf_preserved := att_conf_preserved + 1;
      END IF;
    END LOOP;

    SELECT count(DISTINCT l.attachment_id) INTO n
      FROM abd_ocs_attachment_comment_links l
      JOIN abd_ocs_comments c ON c.id = l.comment_id
     WHERE c.source_parent_comment_id = pid;
    att_group_atts := att_group_atts + coalesce(n,0);
  END LOOP;

  RETURN jsonb_build_object(
    'parents', parents,
    'missing_parent', missing_parent,
    'v2_active', v2_active,
    'unchanged', unchanged,
    'updated', updated,
    'inserted', inserted,
    'superseded', superseded,
    'changed_parents', changed_parents,
    'linked_children', linked_children,
    'unmatched_children', unmatched_children,
    'compliance_preserved', comp_preserved,
    'compliance_blocked_user_true', comp_at_risk_user_true,
    'compliance_user_false', comp_user_false,
    'compliance_import_a_preserved', comp_import_a_preserved,
    'compliance_import_a_at_risk', comp_import_a_at_risk,
    'compliance_log_rows', comp_log_rows,
    'att_confirmed_preserved', att_conf_preserved,
    'att_confirmed_downgraded', att_conf_downgrade,
    'att_group_attachments', att_group_atts,
    'expected_complied', expected_complied,
    'parent_ids', to_jsonb(parent_ids),
    'missing_parent_ids', to_jsonb(missing_ids),
    'conflict_ids', to_jsonb(conflict_ids),
    'superseded_ids', to_jsonb(superseded_ids),
    'blocked_ids', to_jsonb(blocked_ids),
    'abd_item_ids', to_jsonb(abd_ids),
    'changed_parent_ids', to_jsonb(changed_pids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.abd_ocs_v3_dryrun_parents(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.abd_ocs_v3_dryrun_parents(jsonb) TO authenticated, service_role;
