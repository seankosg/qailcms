-- ============ 1) groups ============
CREATE TABLE IF NOT EXISTS public.abd_ocs_comment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE,
  source_parent_comment_id text NOT NULL,
  ocs_number text,
  ocs_number_norm text,
  source_drawing_number text,
  drawing_number_norm text,
  source_file_name text,
  source_sheet_name text,
  source_row_index integer,
  atomic_item_count integer NOT NULL DEFAULT 1,
  contractor_response_raw text,
  response_mapping_status text NOT NULL DEFAULT 'unmapped',
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abd_ocs_comment_groups_count_chk CHECK (atomic_item_count >= 1),
  CONSTRAINT abd_ocs_comment_groups_resp_chk CHECK (response_mapping_status IN ('mapped','inherited','unmapped'))
);
CREATE INDEX IF NOT EXISTS abd_ocs_comment_groups_parent_idx ON public.abd_ocs_comment_groups (source_parent_comment_id);

GRANT SELECT ON public.abd_ocs_comment_groups TO authenticated;
GRANT ALL ON public.abd_ocs_comment_groups TO service_role;
ALTER TABLE public.abd_ocs_comment_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abd_ocs_groups_admin_write ON public.abd_ocs_comment_groups;
CREATE POLICY abd_ocs_groups_admin_write ON public.abd_ocs_comment_groups
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS abd_ocs_comment_groups_touch ON public.abd_ocs_comment_groups;
CREATE TRIGGER abd_ocs_comment_groups_touch
  BEFORE UPDATE ON public.abd_ocs_comment_groups
  FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

-- ============ 2) comments: atomic columns ============
ALTER TABLE public.abd_ocs_comments
  ADD COLUMN IF NOT EXISTS comment_group_id uuid REFERENCES public.abd_ocs_comment_groups(id),
  ADD COLUMN IF NOT EXISTS source_parent_comment_id text,
  ADD COLUMN IF NOT EXISTS atomic_item_no integer,
  ADD COLUMN IF NOT EXISTS atomic_item_count integer,
  ADD COLUMN IF NOT EXISTS split_status text,
  ADD COLUMN IF NOT EXISTS response_mapping_status text,
  ADD COLUMN IF NOT EXISTS is_superseded_by_v2 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS v2_import_log_id uuid;

CREATE INDEX IF NOT EXISTS abd_ocs_comments_group_idx ON public.abd_ocs_comments (comment_group_id);
CREATE INDEX IF NOT EXISTS abd_ocs_comments_parent_idx ON public.abd_ocs_comments (source_parent_comment_id);

DROP POLICY IF EXISTS abd_ocs_groups_read ON public.abd_ocs_comment_groups;
CREATE POLICY abd_ocs_groups_read ON public.abd_ocs_comment_groups
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.abd_ocs_comments c
      WHERE c.comment_group_id = abd_ocs_comment_groups.id
        AND public.abd_ocs_comment_visible(c.id)
    )
  );

-- ============ 3) attachment <-> comment links ============
CREATE TABLE IF NOT EXISTS public.abd_ocs_attachment_comment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES public.abd_ocs_attachments(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.abd_ocs_comments(id) ON DELETE CASCADE,
  source_attachment_id text,
  source_comment_id text,
  mapping_method text,
  mapping_status text NOT NULL DEFAULT 'confirmed',
  sort_order integer,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abd_ocs_att_link_uniq UNIQUE (attachment_id, comment_id),
  CONSTRAINT abd_ocs_att_link_status_chk CHECK (mapping_status IN ('confirmed','inherited','unresolved'))
);
CREATE INDEX IF NOT EXISTS abd_ocs_att_link_comment_idx ON public.abd_ocs_attachment_comment_links (comment_id);
CREATE INDEX IF NOT EXISTS abd_ocs_att_link_att_idx ON public.abd_ocs_attachment_comment_links (attachment_id);

GRANT SELECT ON public.abd_ocs_attachment_comment_links TO authenticated;
GRANT ALL ON public.abd_ocs_attachment_comment_links TO service_role;
ALTER TABLE public.abd_ocs_attachment_comment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abd_ocs_att_link_admin_write ON public.abd_ocs_attachment_comment_links;
CREATE POLICY abd_ocs_att_link_admin_write ON public.abd_ocs_attachment_comment_links
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS abd_ocs_att_link_read ON public.abd_ocs_attachment_comment_links;
CREATE POLICY abd_ocs_att_link_read ON public.abd_ocs_attachment_comment_links
  FOR SELECT TO authenticated
  USING (public.abd_ocs_comment_visible(comment_id));

DROP TRIGGER IF EXISTS abd_ocs_att_link_touch ON public.abd_ocs_attachment_comment_links;
CREATE TRIGGER abd_ocs_att_link_touch
  BEFORE UPDATE ON public.abd_ocs_attachment_comment_links
  FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

-- ============ 4) storage read policy extension ============
DROP POLICY IF EXISTS abd_ocs_att_read ON storage.objects;
CREATE POLICY abd_ocs_att_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'abd-ocs-attachments'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.abd_ocs_attachments a
        WHERE a.storage_path = objects.name
          AND a.link_status = 'linked'
          AND a.comment_id IS NOT NULL
          AND public.abd_ocs_comment_visible(a.comment_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.abd_ocs_attachments a
        JOIN public.abd_ocs_attachment_comment_links l ON l.attachment_id = a.id
        WHERE a.storage_path = objects.name
          AND public.abd_ocs_comment_visible(l.comment_id)
      )
    )
  );

-- ============ 5) backup inventory 62 -> 64 ============
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
    'abd_ocs_compliance','abd_ocs_attachments','abd_ocs_attachment_comment_links','abd_ocs_compliance_log'
  ]::text[]
$function$;

-- ============ 6) V2 dry-run ============
CREATE OR REPLACE FUNCTION public.abd_ocs_v2_dryrun_comments(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    'distinct_groups', count(DISTINCT gkey),
    'distinct_parents', count(DISTINCT pid),
    'distinct_abd_items', count(DISTINCT parent_abd_item_id),
    'parents_split_with_user_check',
      count(DISTINCT pid) FILTER (WHERE parent_compliance_source = 'user' AND parent_user_complied AND pid IS DISTINCT FROM sid),
    'parents_with_user_row',
      count(DISTINCT pid) FILTER (WHERE parent_compliance_source = 'user' AND pid IS DISTINCT FROM sid),
    'missing_item_no', count(*) FILTER (WHERE item_no IS NULL)
  ) INTO v_res FROM j;
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_dryrun_attachments(p_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'ids', cardinality(p_ids),
    'resolved', count(a.id),
    'unresolved', cardinality(p_ids) - count(a.id)
  ) INTO v_res
  FROM unnest(p_ids) s(sid)
  LEFT JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.sid;
  RETURN v_res;
END;
$function$;

-- ============ 7) V2 import ============
CREATE OR REPLACE FUNCTION public.abd_ocs_v2_import_groups(p_import_log_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ins int := 0; v_upd int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH r AS (
    SELECT x->>'group_key' AS group_key,
           x->>'source_parent_comment_id' AS pid,
           x->>'ocs_number' AS ocs_number,
           x->>'source_drawing_number' AS dwg,
           x->>'source_file_name' AS fname,
           x->>'source_sheet_name' AS sheet,
           NULLIF(x->>'source_row_index','')::int AS row_idx,
           COALESCE(NULLIF(x->>'atomic_item_count','')::int, 1) AS cnt,
           x->>'contractor_response_raw' AS resp,
           COALESCE(NULLIF(x->>'response_mapping_status',''), 'unmapped') AS resp_status
    FROM jsonb_array_elements(p_rows) x
  ), up AS (
    INSERT INTO public.abd_ocs_comment_groups AS g (
      group_key, source_parent_comment_id, ocs_number, ocs_number_norm,
      source_drawing_number, drawing_number_norm, source_file_name, source_sheet_name,
      source_row_index, atomic_item_count, contractor_response_raw, response_mapping_status, import_log_id
    )
    SELECT r.group_key, r.pid, r.ocs_number, public.abd_ocs_norm(r.ocs_number),
           r.dwg, public.abd_ocs_norm(r.dwg), r.fname, r.sheet,
           r.row_idx, r.cnt, r.resp, r.resp_status, p_import_log_id
    FROM r
    ON CONFLICT (group_key) DO UPDATE SET
      source_parent_comment_id = EXCLUDED.source_parent_comment_id,
      ocs_number = EXCLUDED.ocs_number,
      ocs_number_norm = EXCLUDED.ocs_number_norm,
      source_drawing_number = EXCLUDED.source_drawing_number,
      drawing_number_norm = EXCLUDED.drawing_number_norm,
      source_file_name = EXCLUDED.source_file_name,
      source_sheet_name = EXCLUDED.source_sheet_name,
      source_row_index = EXCLUDED.source_row_index,
      atomic_item_count = EXCLUDED.atomic_item_count,
      contractor_response_raw = EXCLUDED.contractor_response_raw,
      response_mapping_status = EXCLUDED.response_mapping_status,
      import_log_id = EXCLUDED.import_log_id
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_ins, v_upd FROM up;
  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd);
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_import_comments(p_import_log_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ins int := 0; v_upd int := 0; v_missing_parent int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH r AS (
    SELECT x->>'source_comment_id' AS sid,
           x->>'source_parent_comment_id' AS pid,
           x->>'group_key' AS gkey,
           NULLIF(x->>'atomic_item_no','')::int AS item_no,
           NULLIF(x->>'atomic_item_count','')::int AS item_cnt,
           COALESCE(NULLIF(x->>'split_status',''),'atomic') AS split_status,
           COALESCE(NULLIF(x->>'response_mapping_status',''),'inherited') AS resp_status,
           x->>'ocs_comment' AS ocs_comment,
           x->>'assessed_code' AS assessed_code,
           x->>'contractor_response' AS contractor_response,
           x->>'comment_part' AS comment_part,
           x->>'source_row_hash' AS row_hash
    FROM jsonb_array_elements(p_rows) x
  ), j AS (
    SELECT r.*, p.*, g.id AS group_id
    FROM r
    JOIN LATERAL (
      SELECT c.id AS parent_id, c.ocs_number, c.ocs_number_norm, c.source_drawing_number,
             c.drawing_number_norm, c.ocs_sn, c.file_revision, c.comment_revision,
             c.sign_off_status, c.source_file_name, c.source_sheet_name, c.source_row_index,
             c.source_modified_at, c.abd_item_id, c.link_status, c.link_method, c.linked_at,
             c.team, c.discipline, c.service, c.plot, c.project, c.source_file_hash,
             c.warning_codes, c.review_priority
      FROM public.abd_ocs_comments c WHERE c.source_comment_id = r.pid
    ) p ON true
    LEFT JOIN public.abd_ocs_comment_groups g ON g.group_key = r.gkey
  ), up AS (
    INSERT INTO public.abd_ocs_comments AS t (
      source_comment_id, ocs_number, ocs_number_norm, source_drawing_number, drawing_number_norm,
      ocs_sn, file_revision, comment_revision, comment_part, ocs_comment, assessed_code,
      contractor_response, sign_off_status, source_file_name, source_sheet_name, source_row_index,
      source_row_hash, source_modified_at, import_log_id, imported_at,
      abd_item_id, link_status, link_method, linked_at,
      team, discipline, service, plot, project, source_file_hash, warning_codes, review_priority,
      is_active, comment_group_id, source_parent_comment_id, atomic_item_no, atomic_item_count,
      split_status, response_mapping_status, v2_import_log_id
    )
    SELECT j.sid, j.ocs_number, j.ocs_number_norm, j.source_drawing_number, j.drawing_number_norm,
           j.ocs_sn, j.file_revision, j.comment_revision, j.comment_part, j.ocs_comment, j.assessed_code,
           j.contractor_response, j.sign_off_status, j.source_file_name, j.source_sheet_name, j.source_row_index,
           j.row_hash, j.source_modified_at, p_import_log_id, now(),
           j.abd_item_id, j.link_status, j.link_method, j.linked_at,
           j.team, j.discipline, j.service, j.plot, j.project, j.source_file_hash, j.warning_codes, j.review_priority,
           true, j.group_id, j.pid, j.item_no, j.item_cnt,
           j.split_status, j.resp_status, p_import_log_id
    FROM j
    ON CONFLICT (source_comment_id) DO UPDATE SET
      ocs_comment = EXCLUDED.ocs_comment,
      assessed_code = EXCLUDED.assessed_code,
      contractor_response = EXCLUDED.contractor_response,
      comment_part = EXCLUDED.comment_part,
      abd_item_id = EXCLUDED.abd_item_id,
      link_status = EXCLUDED.link_status,
      link_method = EXCLUDED.link_method,
      linked_at = EXCLUDED.linked_at,
      comment_group_id = EXCLUDED.comment_group_id,
      source_parent_comment_id = EXCLUDED.source_parent_comment_id,
      atomic_item_no = EXCLUDED.atomic_item_no,
      atomic_item_count = EXCLUDED.atomic_item_count,
      split_status = EXCLUDED.split_status,
      response_mapping_status = EXCLUDED.response_mapping_status,
      v2_import_log_id = EXCLUDED.v2_import_log_id,
      is_active = true,
      is_superseded_by_v2 = false,
      superseded_at = NULL,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_ins, v_upd FROM up;

  SELECT count(*) INTO v_missing_parent
  FROM jsonb_array_elements(p_rows) x
  WHERE NOT EXISTS (SELECT 1 FROM public.abd_ocs_comments c WHERE c.source_comment_id = x->>'source_parent_comment_id');

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped_missing_parent', v_missing_parent);
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_import_links(p_import_log_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ins int := 0; v_upd int := 0; v_unres int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH r AS (
    SELECT x->>'source_attachment_id' AS said,
           x->>'source_comment_id' AS scid,
           COALESCE(NULLIF(x->>'mapping_method',''),'ui_access_link') AS method,
           COALESCE(NULLIF(x->>'mapping_status',''),'confirmed') AS status,
           NULLIF(x->>'sort_order','')::int AS sort_order
    FROM jsonb_array_elements(p_rows) x
  ), j AS (
    SELECT r.*, a.id AS att_id, c.id AS cmt_id
    FROM r
    LEFT JOIN public.abd_ocs_attachments a ON a.source_attachment_id = r.said
    LEFT JOIN public.abd_ocs_comments c ON c.source_comment_id = r.scid
  ), up AS (
    INSERT INTO public.abd_ocs_attachment_comment_links AS l (
      attachment_id, comment_id, source_attachment_id, source_comment_id,
      mapping_method, mapping_status, sort_order, import_log_id
    )
    SELECT att_id, cmt_id, said, scid, method, status, sort_order, p_import_log_id
    FROM j WHERE att_id IS NOT NULL AND cmt_id IS NOT NULL
    ON CONFLICT (attachment_id, comment_id) DO UPDATE SET
      mapping_method = EXCLUDED.mapping_method,
      mapping_status = EXCLUDED.mapping_status,
      sort_order = EXCLUDED.sort_order,
      import_log_id = EXCLUDED.import_log_id,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_ins, v_upd FROM up;

  SELECT count(*) INTO v_unres FROM (
    SELECT 1 FROM jsonb_array_elements(p_rows) x
    WHERE NOT EXISTS (SELECT 1 FROM public.abd_ocs_attachments a WHERE a.source_attachment_id = x->>'source_attachment_id')
       OR NOT EXISTS (SELECT 1 FROM public.abd_ocs_comments c WHERE c.source_comment_id = x->>'source_comment_id')
  ) q;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unresolved', v_unres);
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_finalize_parents(p_import_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  WITH parents AS (
    SELECT DISTINCT ch.source_parent_comment_id AS pid
    FROM public.abd_ocs_comments ch
    WHERE ch.v2_import_log_id = p_import_log_id
      AND ch.source_parent_comment_id IS NOT NULL
      AND ch.source_parent_comment_id <> ch.source_comment_id
  ), upd AS (
    UPDATE public.abd_ocs_comments p
       SET is_active = false,
           is_superseded_by_v2 = true,
           superseded_at = now(),
           inactive_at = COALESCE(p.inactive_at, now()),
           retired_reason = COALESCE(p.retired_reason, 'superseded_by_atomic_v2'),
           updated_at = now()
      FROM parents
     WHERE p.source_comment_id = parents.pid
       AND p.is_active = true
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('superseded_parents', v_n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v2_verify()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'groups', (SELECT count(*) FROM public.abd_ocs_comment_groups),
    'comments_active', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active),
    'comments_atomic_active', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND comment_group_id IS NOT NULL),
    'comments_superseded', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_superseded_by_v2),
    'linked_active', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND link_status = 'linked' AND abd_item_id IS NOT NULL),
    'unlinked_active', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND (link_status IS DISTINCT FROM 'linked' OR abd_item_id IS NULL)),
    'attachments', (SELECT count(*) FROM public.abd_ocs_attachments),
    'links', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links),
    'links_unresolved', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links WHERE mapping_status = 'unresolved'),
    'compliance_rows', (SELECT count(*) FROM public.abd_ocs_compliance),
    'compliance_user', (SELECT count(*) FROM public.abd_ocs_compliance WHERE source = 'user'),
    'compliance_orphan_inactive', (
      SELECT count(*) FROM public.abd_ocs_compliance cp
      JOIN public.abd_ocs_comments c ON c.id = cp.comment_id
      WHERE NOT c.is_active
    ),
    'attachments_without_link', (
      SELECT count(*) FROM public.abd_ocs_attachments a
      WHERE NOT EXISTS (SELECT 1 FROM public.abd_ocs_attachment_comment_links l WHERE l.attachment_id = a.id)
    )
  ) INTO v;
  RETURN v;
END;
$function$;

-- ============ 8) detail panel query: links + legacy union, V2 ordering ============
CREATE OR REPLACE FUNCTION public.abd_ocs_comments_for_item(p_abd_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_can_write boolean := false;
  v_rows jsonb;
  v_total int := 0;
  v_complied int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OCS_UNAUTHENTICATED';
  END IF;
  IF NOT public.rcl_can(v_uid, 'ABD', p_abd_item_id, 'read') THEN
    RAISE EXCEPTION 'OCS_FORBIDDEN_READ';
  END IF;
  v_can_write := public.rcl_can(v_uid, 'ABD', p_abd_item_id, 'write');

  WITH c AS (
    SELECT co.*,
           COALESCE(cp.complied, false) AS complied,
           cp.source AS compliance_source,
           cp.complied_by_name,
           cp.complied_at
    FROM public.abd_ocs_comments co
    LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = co.id
    WHERE co.abd_item_id = p_abd_item_id
      AND co.is_active = true
      AND co.link_status = 'linked'
  ), pairs AS (
    SELECT l.comment_id, l.attachment_id, l.mapping_status, l.mapping_method, l.sort_order
    FROM public.abd_ocs_attachment_comment_links l
    WHERE l.comment_id IN (SELECT id FROM c)
    UNION
    SELECT at.comment_id, at.id, 'confirmed', 'legacy_comment_id', at.sort_order
    FROM public.abd_ocs_attachments at
    WHERE at.comment_id IN (SELECT id FROM c)
      AND NOT EXISTS (
        SELECT 1 FROM public.abd_ocs_attachment_comment_links l2
        WHERE l2.comment_id = at.comment_id AND l2.attachment_id = at.id
      )
  ), a AS (
    SELECT p.comment_id,
           jsonb_agg(jsonb_build_object(
             'id', at.id,
             'source_attachment_id', at.source_attachment_id,
             'storage_path', at.storage_path,
             'mime_type', at.mime_type,
             'width', at.width,
             'height', at.height,
             'sort_order', COALESCE(p.sort_order, at.sort_order),
             'mapping_status', p.mapping_status,
             'mapping_method', p.mapping_method
           ) ORDER BY COALESCE(p.sort_order, at.sort_order), at.source_attachment_id) AS atts
    FROM pairs p
    JOIN public.abd_ocs_attachments at ON at.id = p.attachment_id
    GROUP BY p.comment_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'source_comment_id', c.source_comment_id,
           'ocs_number', c.ocs_number,
           'ocs_sn', c.ocs_sn,
           'file_revision', c.file_revision,
           'comment_revision', c.comment_revision,
           'comment_part', c.comment_part,
           'ocs_comment', c.ocs_comment,
           'assessed_code', c.assessed_code,
           'contractor_response', c.contractor_response,
           'sign_off_status', c.sign_off_status,
           'source_file_name', c.source_file_name,
           'source_sheet_name', c.source_sheet_name,
           'source_row_index', c.source_row_index,
           'atomic_item_no', c.atomic_item_no,
           'atomic_item_count', c.atomic_item_count,
           'split_status', c.split_status,
           'response_mapping_status', c.response_mapping_status,
           'source_parent_comment_id', c.source_parent_comment_id,
           'complied', c.complied,
           'compliance_source', c.compliance_source,
           'complied_by_name', c.complied_by_name,
           'complied_at', c.complied_at,
           'attachments', COALESCE(a.atts, '[]'::jsonb)
         ) ORDER BY c.ocs_number NULLS LAST, c.source_row_index NULLS LAST,
                    c.source_parent_comment_id NULLS LAST, c.atomic_item_no NULLS FIRST,
                    c.source_comment_id), '[]'::jsonb)
    INTO v_rows
  FROM c LEFT JOIN a ON a.comment_id = c.id;

  SELECT count(*), count(*) FILTER (WHERE cp.complied)
    INTO v_total, v_complied
  FROM public.abd_ocs_comments co
  LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = co.id
  WHERE co.abd_item_id = p_abd_item_id AND co.is_active = true AND co.link_status = 'linked';

  RETURN jsonb_build_object(
    'can_write', v_can_write,
    'total', v_total,
    'complied', v_complied,
    'pending', v_total - v_complied,
    'comments', v_rows
  );
END;
$function$;