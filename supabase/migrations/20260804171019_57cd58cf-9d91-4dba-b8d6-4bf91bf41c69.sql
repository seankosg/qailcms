-- 1. 첨부 테이블 보완 -------------------------------------------------
ALTER TABLE public.abd_ocs_attachments
  ALTER COLUMN comment_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_comment_id text,
  ADD COLUMN IF NOT EXISTS source_image_index integer,
  ADD COLUMN IF NOT EXISTS image_format text,
  ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'unmatched';

ALTER TABLE public.abd_ocs_attachments RENAME COLUMN sha256 TO content_hash;

ALTER TABLE public.abd_ocs_attachments
  ADD CONSTRAINT abd_ocs_attachments_link_status_chk
  CHECK (link_status IN ('linked','unmatched','needs_review'));

COMMENT ON COLUMN public.abd_ocs_attachments.storage_path IS
  '정본 경로. manifest 의 relative_path 를 그대로 저장한다(별도 relative_path 컬럼을 두지 않음).';
COMMENT ON COLUMN public.abd_ocs_attachments.content_hash IS 'manifest image_sha256 (소문자 hex 64)';

CREATE INDEX IF NOT EXISTS abd_ocs_attachments_source_comment_idx
  ON public.abd_ocs_attachments (source_comment_id);
CREATE INDEX IF NOT EXISTS abd_ocs_attachments_link_status_idx
  ON public.abd_ocs_attachments (link_status);

-- 2. 코멘트 테이블 보완 -----------------------------------------------
ALTER TABLE public.abd_ocs_comments
  ADD COLUMN IF NOT EXISTS team text;

ALTER TABLE public.abd_ocs_comments
  ADD CONSTRAINT abd_ocs_comments_team_chk CHECK (team IS NULL OR team IN ('MECH','ELEC'));

ALTER TABLE public.abd_ocs_comments
  ADD CONSTRAINT abd_ocs_comments_import_log_fk
  FOREIGN KEY (import_log_id) REFERENCES public.abd_ocs_import_logs(id) ON DELETE SET NULL;

-- 3. 가시성 함수 교체 (RCL 정본 경유) ----------------------------------
CREATE OR REPLACE FUNCTION public.abd_ocs_comment_visible(_comment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.abd_ocs_comments c
      WHERE c.id = _comment_id
        AND c.is_active
        AND c.abd_item_id IS NOT NULL
        AND c.link_status = 'linked'
        AND public.rcl_can(auth.uid(), 'ABD', c.abd_item_id, 'read')
    )
  END
$$;

REVOKE ALL ON FUNCTION public.abd_ocs_comment_visible(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.abd_ocs_comment_visible(uuid) TO authenticated;

-- 4. 정책 교체 ---------------------------------------------------------
DROP POLICY IF EXISTS abd_ocs_comments_select ON public.abd_ocs_comments;
DROP POLICY IF EXISTS abd_ocs_comments_admin_insert ON public.abd_ocs_comments;
DROP POLICY IF EXISTS abd_ocs_comments_admin_update ON public.abd_ocs_comments;
DROP POLICY IF EXISTS abd_ocs_comments_admin_delete ON public.abd_ocs_comments;

CREATE POLICY abd_ocs_comments_select ON public.abd_ocs_comments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (is_active AND abd_item_id IS NOT NULL AND link_status = 'linked'
      AND public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'read'))
);
CREATE POLICY abd_ocs_comments_admin_insert ON public.abd_ocs_comments FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY abd_ocs_comments_admin_update ON public.abd_ocs_comments FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS abd_ocs_attachments_select ON public.abd_ocs_attachments;
DROP POLICY IF EXISTS abd_ocs_attachments_admin_insert ON public.abd_ocs_attachments;
DROP POLICY IF EXISTS abd_ocs_attachments_admin_update ON public.abd_ocs_attachments;
DROP POLICY IF EXISTS abd_ocs_attachments_admin_delete ON public.abd_ocs_attachments;

CREATE POLICY abd_ocs_attachments_select ON public.abd_ocs_attachments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (link_status = 'linked' AND comment_id IS NOT NULL AND public.abd_ocs_comment_visible(comment_id))
);
CREATE POLICY abd_ocs_attachments_admin_insert ON public.abd_ocs_attachments FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY abd_ocs_attachments_admin_update ON public.abd_ocs_attachments FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS abd_ocs_compliance_admin_delete ON public.abd_ocs_compliance;
DROP POLICY IF EXISTS abd_ocs_compliance_admin_insert ON public.abd_ocs_compliance;
DROP POLICY IF EXISTS abd_ocs_compliance_admin_update ON public.abd_ocs_compliance;
CREATE POLICY abd_ocs_compliance_admin_insert ON public.abd_ocs_compliance FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY abd_ocs_compliance_admin_update ON public.abd_ocs_compliance FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS abd_ocs_import_logs_admin_select ON public.abd_ocs_import_logs;
DROP POLICY IF EXISTS abd_ocs_import_logs_admin_insert ON public.abd_ocs_import_logs;
DROP POLICY IF EXISTS abd_ocs_import_logs_admin_update ON public.abd_ocs_import_logs;
CREATE POLICY abd_ocs_import_logs_admin_select ON public.abd_ocs_import_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY abd_ocs_import_logs_admin_insert ON public.abd_ocs_import_logs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY abd_ocs_import_logs_admin_update ON public.abd_ocs_import_logs FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS abd_ocs_compliance_log_admin_select ON public.abd_ocs_compliance_log;
CREATE POLICY abd_ocs_compliance_log_admin_select ON public.abd_ocs_compliance_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 5. Storage 정책: strict admin 만 쓰기 --------------------------------
DROP POLICY IF EXISTS abd_ocs_att_admin_insert ON storage.objects;
DROP POLICY IF EXISTS abd_ocs_att_admin_update ON storage.objects;
DROP POLICY IF EXISTS abd_ocs_att_admin_delete ON storage.objects;
DROP POLICY IF EXISTS abd_ocs_att_admin_select ON storage.objects;

CREATE POLICY abd_ocs_att_admin_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'abd-ocs-attachments' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY abd_ocs_att_admin_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'abd-ocs-attachments' AND public.has_role(auth.uid(),'admin'))
WITH CHECK (bucket_id = 'abd-ocs-attachments' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY abd_ocs_att_admin_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'abd-ocs-attachments' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY abd_ocs_att_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'abd-ocs-attachments'
  AND (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (
      SELECT 1 FROM public.abd_ocs_attachments a
      WHERE a.storage_path = storage.objects.name
        AND a.link_status = 'linked'
        AND a.comment_id IS NOT NULL
        AND public.abd_ocs_comment_visible(a.comment_id)
    )
  )
);

-- 6. 백업 대상 62개 ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
    'abd_ocs_import_logs','abd_ocs_comments','abd_ocs_compliance','abd_ocs_attachments','abd_ocs_compliance_log'
  ]::text[]
$$;