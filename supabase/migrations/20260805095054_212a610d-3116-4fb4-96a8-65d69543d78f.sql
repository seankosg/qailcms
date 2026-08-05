-- =====================================================================
-- ABD OCS Atomic V3 최종 이관 인프라
-- =====================================================================

-- 1) 코멘트 ↔ ABD 다대다 연결표 (linked_multi 보존용)
CREATE TABLE IF NOT EXISTS public.abd_ocs_comment_abd_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.abd_ocs_comments(id) ON DELETE CASCADE,
  abd_item_id uuid NOT NULL REFERENCES public.abd_items_raw(id) ON DELETE CASCADE,
  abd_number text NOT NULL,
  source_comment_id text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  link_method text NOT NULL DEFAULT 'v3_atomic',
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, abd_item_id)
);
GRANT SELECT ON public.abd_ocs_comment_abd_links TO authenticated;
GRANT ALL ON public.abd_ocs_comment_abd_links TO service_role;
ALTER TABLE public.abd_ocs_comment_abd_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abd_ocs_comment_abd_links_read"
  ON public.abd_ocs_comment_abd_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_ocs_comment_abd_links_admin_write"
  ON public.abd_ocs_comment_abd_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS idx_abd_ocs_cal_comment ON public.abd_ocs_comment_abd_links(comment_id);
CREATE INDEX IF NOT EXISTS idx_abd_ocs_cal_abd ON public.abd_ocs_comment_abd_links(abd_item_id);
CREATE TRIGGER trg_abd_ocs_cal_touch BEFORE UPDATE ON public.abd_ocs_comment_abd_links
  FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

-- 2) 스테이징 테이블 4종
CREATE TABLE IF NOT EXISTS public.abd_ocs_v3_stage_comments (
  stage_run_id uuid NOT NULL,
  source_comment_id text NOT NULL,
  source_parent_comment_id text NOT NULL,
  comment_group_id text,
  atomic_item_no int,
  atomic_item_count int,
  split_status text,
  comment_part int,
  ocs_comment text,
  assessed_code text,
  contractor_response text,
  ocs_number text,
  drawing_number text,
  source_file_name text,
  source_sheet_name text,
  source_row_index int,
  abd_numbers text[] NOT NULL DEFAULT '{}',
  link_status text,
  link_scope text,
  link_method text,
  is_active boolean NOT NULL DEFAULT true,
  retired_reason text,
  initial_complied boolean NOT NULL DEFAULT false,
  compliance_source text,
  compliance_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_run_id, source_comment_id)
);

CREATE TABLE IF NOT EXISTS public.abd_ocs_v3_stage_groups (
  stage_run_id uuid NOT NULL,
  group_id text NOT NULL,
  source_parent_comment_id text NOT NULL,
  ocs_number text,
  drawing_number text,
  source_file_name text,
  source_sheet text,
  source_row int,
  item_count int,
  split_status text,
  group_contractor_response text,
  v3_ocs_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_run_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.abd_ocs_v3_stage_attachments (
  stage_run_id uuid NOT NULL,
  attachment_id text NOT NULL,
  comment_id text,
  source_parent_comment_id text,
  comment_group_id text,
  atomic_comment_id text,
  attachment_scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_run_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS public.abd_ocs_v3_stage_response (
  stage_run_id uuid NOT NULL,
  group_id text,
  source_parent_comment_id text NOT NULL,
  response_segment_no int NOT NULL,
  response_source_label text,
  response_text text,
  atomic_comment_id text,
  mapping_status text,
  mapping_method text,
  confidence_score numeric,
  source_file_name text,
  source_sheet text,
  source_row int,
  generic_response boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_run_id, source_parent_comment_id, response_segment_no)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['abd_ocs_v3_stage_comments','abd_ocs_v3_stage_groups','abd_ocs_v3_stage_attachments','abd_ocs_v3_stage_response']
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY "%1$s_admin_all" ON public.%1$I FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role))
      WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))$p$, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_v3sc_run ON public.abd_ocs_v3_stage_comments(stage_run_id);
CREATE INDEX IF NOT EXISTS idx_v3sc_parent ON public.abd_ocs_v3_stage_comments(stage_run_id, source_parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_v3sg_run ON public.abd_ocs_v3_stage_groups(stage_run_id);
CREATE INDEX IF NOT EXISTS idx_v3sa_run ON public.abd_ocs_v3_stage_attachments(stage_run_id);
CREATE INDEX IF NOT EXISTS idx_v3sr_run ON public.abd_ocs_v3_stage_response(stage_run_id);

-- 3) 스테이징 적재 RPC
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_reset(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  DELETE FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = p_run;
  DELETE FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id = p_run;
  DELETE FROM public.abd_ocs_v3_stage_attachments WHERE stage_run_id = p_run;
  DELETE FROM public.abd_ocs_v3_stage_response WHERE stage_run_id = p_run;
  DELETE FROM public.abd_ocs_v3_stage_comments WHERE created_at < now() - interval '2 days';
  DELETE FROM public.abd_ocs_v3_stage_groups WHERE created_at < now() - interval '2 days';
  DELETE FROM public.abd_ocs_v3_stage_attachments WHERE created_at < now() - interval '2 days';
  DELETE FROM public.abd_ocs_v3_stage_response WHERE created_at < now() - interval '2 days';
  RETURN jsonb_build_object('ok', true, 'stage_run_id', p_run);
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_load_comments(p_run uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  INSERT INTO public.abd_ocs_v3_stage_comments AS t (
    stage_run_id, source_comment_id, source_parent_comment_id, comment_group_id,
    atomic_item_no, atomic_item_count, split_status, comment_part, ocs_comment, assessed_code,
    contractor_response, ocs_number, drawing_number, source_file_name, source_sheet_name,
    source_row_index, abd_numbers, link_status, link_scope, link_method, is_active,
    retired_reason, initial_complied, compliance_source, compliance_reason
  )
  SELECT p_run,
         x->>'source_comment_id', x->>'source_parent_comment_id', NULLIF(x->>'comment_group_id',''),
         NULLIF(x->>'atomic_item_no','')::int, NULLIF(x->>'atomic_item_count','')::int,
         NULLIF(x->>'split_status',''), NULLIF(x->>'comment_part','')::int,
         x->>'ocs_comment', NULLIF(x->>'assessed_code',''), x->>'contractor_response',
         NULLIF(x->>'ocs_number',''), NULLIF(x->>'drawing_number',''),
         NULLIF(x->>'source_file_name',''), NULLIF(x->>'source_sheet_name',''),
         NULLIF(x->>'source_row_index','')::int,
         COALESCE((SELECT array_agg(v::text) FROM jsonb_array_elements_text(COALESCE(x->'abd_numbers','[]'::jsonb)) v), '{}'),
         NULLIF(x->>'link_status',''), NULLIF(x->>'link_scope',''), NULLIF(x->>'link_method',''),
         COALESCE((x->>'is_active')::boolean, true), NULLIF(x->>'retired_reason',''),
         COALESCE((x->>'initial_complied')::boolean, false),
         NULLIF(x->>'compliance_source',''), NULLIF(x->>'compliance_reason','')
  FROM jsonb_array_elements(p_rows) x
  ON CONFLICT (stage_run_id, source_comment_id) DO UPDATE SET
    source_parent_comment_id = EXCLUDED.source_parent_comment_id,
    comment_group_id = EXCLUDED.comment_group_id,
    atomic_item_no = EXCLUDED.atomic_item_no,
    atomic_item_count = EXCLUDED.atomic_item_count,
    split_status = EXCLUDED.split_status,
    comment_part = EXCLUDED.comment_part,
    ocs_comment = EXCLUDED.ocs_comment,
    assessed_code = EXCLUDED.assessed_code,
    contractor_response = EXCLUDED.contractor_response,
    ocs_number = EXCLUDED.ocs_number,
    drawing_number = EXCLUDED.drawing_number,
    source_file_name = EXCLUDED.source_file_name,
    source_sheet_name = EXCLUDED.source_sheet_name,
    source_row_index = EXCLUDED.source_row_index,
    abd_numbers = EXCLUDED.abd_numbers,
    link_status = EXCLUDED.link_status,
    link_scope = EXCLUDED.link_scope,
    link_method = EXCLUDED.link_method,
    is_active = EXCLUDED.is_active,
    retired_reason = EXCLUDED.retired_reason,
    initial_complied = EXCLUDED.initial_complied,
    compliance_source = EXCLUDED.compliance_source,
    compliance_reason = EXCLUDED.compliance_reason;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('loaded', v_n,
    'total', (SELECT count(*) FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = p_run));
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_load_groups(p_run uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  INSERT INTO public.abd_ocs_v3_stage_groups AS t (
    stage_run_id, group_id, source_parent_comment_id, ocs_number, drawing_number,
    source_file_name, source_sheet, source_row, item_count, split_status,
    group_contractor_response, v3_ocs_number
  )
  SELECT p_run, x->>'group_id', x->>'source_parent_comment_id', NULLIF(x->>'ocs_number',''),
         NULLIF(x->>'drawing_number',''), NULLIF(x->>'source_file_name',''),
         NULLIF(x->>'source_sheet',''), NULLIF(x->>'source_row','')::int,
         NULLIF(x->>'item_count','')::int, NULLIF(x->>'split_status',''),
         x->>'group_contractor_response', NULLIF(x->>'v3_ocs_number','')
  FROM jsonb_array_elements(p_rows) x
  ON CONFLICT (stage_run_id, group_id) DO UPDATE SET
    source_parent_comment_id = EXCLUDED.source_parent_comment_id,
    ocs_number = EXCLUDED.ocs_number, drawing_number = EXCLUDED.drawing_number,
    source_file_name = EXCLUDED.source_file_name, source_sheet = EXCLUDED.source_sheet,
    source_row = EXCLUDED.source_row, item_count = EXCLUDED.item_count,
    split_status = EXCLUDED.split_status,
    group_contractor_response = EXCLUDED.group_contractor_response,
    v3_ocs_number = EXCLUDED.v3_ocs_number;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('loaded', v_n,
    'total', (SELECT count(*) FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id = p_run));
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_load_attachments(p_run uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  INSERT INTO public.abd_ocs_v3_stage_attachments AS t (
    stage_run_id, attachment_id, comment_id, source_parent_comment_id,
    comment_group_id, atomic_comment_id, attachment_scope
  )
  SELECT p_run, x->>'attachment_id', NULLIF(x->>'comment_id',''),
         NULLIF(x->>'source_parent_comment_id',''), NULLIF(x->>'comment_group_id',''),
         NULLIF(x->>'atomic_comment_id',''), NULLIF(x->>'attachment_scope','')
  FROM jsonb_array_elements(p_rows) x
  ON CONFLICT (stage_run_id, attachment_id) DO UPDATE SET
    comment_id = EXCLUDED.comment_id,
    source_parent_comment_id = EXCLUDED.source_parent_comment_id,
    comment_group_id = EXCLUDED.comment_group_id,
    atomic_comment_id = EXCLUDED.atomic_comment_id,
    attachment_scope = EXCLUDED.attachment_scope;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('loaded', v_n,
    'total', (SELECT count(*) FROM public.abd_ocs_v3_stage_attachments WHERE stage_run_id = p_run));
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_load_response(p_run uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  INSERT INTO public.abd_ocs_v3_stage_response AS t (
    stage_run_id, group_id, source_parent_comment_id, response_segment_no,
    response_source_label, response_text, atomic_comment_id, mapping_status,
    mapping_method, confidence_score, source_file_name, source_sheet, source_row, generic_response
  )
  SELECT p_run, NULLIF(x->>'group_id',''), x->>'source_parent_comment_id',
         (x->>'response_segment_no')::int, NULLIF(x->>'response_source_label',''),
         x->>'response_text', NULLIF(x->>'atomic_comment_id',''),
         NULLIF(x->>'mapping_status',''), NULLIF(x->>'mapping_method',''),
         NULLIF(x->>'confidence_score','')::numeric, NULLIF(x->>'source_file_name',''),
         NULLIF(x->>'source_sheet',''), NULLIF(x->>'source_row','')::int,
         COALESCE((x->>'generic_response')::boolean, false)
  FROM jsonb_array_elements(p_rows) x
  ON CONFLICT (stage_run_id, source_parent_comment_id, response_segment_no) DO UPDATE SET
    group_id = EXCLUDED.group_id,
    response_source_label = EXCLUDED.response_source_label,
    response_text = EXCLUDED.response_text,
    atomic_comment_id = EXCLUDED.atomic_comment_id,
    mapping_status = EXCLUDED.mapping_status,
    mapping_method = EXCLUDED.mapping_method,
    confidence_score = EXCLUDED.confidence_score,
    source_file_name = EXCLUDED.source_file_name,
    source_sheet = EXCLUDED.source_sheet,
    source_row = EXCLUDED.source_row,
    generic_response = EXCLUDED.generic_response;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('loaded', v_n,
    'total', (SELECT count(*) FROM public.abd_ocs_v3_stage_response WHERE stage_run_id = p_run));
END $$;

-- 4) 첨부 전역 지표 (정책 확정 정의: confirmed 개별 링크가 하나도 없는 고유 attachment = group_only)
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_attachment_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'unique_attachments', (SELECT count(*) FROM public.abd_ocs_attachments),
    'attachments_with_confirmed_atomic_links',
      (SELECT count(DISTINCT attachment_id) FROM public.abd_ocs_attachment_comment_links
        WHERE mapping_status IN ('confirmed','confirmed_high')),
    'attachments_group_only',
      (SELECT count(*) FROM public.abd_ocs_attachments a
        WHERE NOT EXISTS (SELECT 1 FROM public.abd_ocs_attachment_comment_links l
                          WHERE l.attachment_id = a.id
                            AND l.mapping_status IN ('confirmed','confirmed_high'))),
    'confirmed_attachment_comment_link_rows',
      (SELECT count(*) FROM public.abd_ocs_attachment_comment_links
        WHERE mapping_status IN ('confirmed','confirmed_high')),
    'group_inherited_access_rows',
      (SELECT count(*) FROM public.abd_ocs_attachment_comment_links WHERE mapping_status = 'inherited'),
    'total_link_rows', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links)
  )
$$;

-- 5) 최종 Dry-run (읽기 전용, 18개 기대값 전량)
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_dryrun(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
    'user_compliance_conflicts', (SELECT count(*) FROM abd_ocs_compliance cp JOIN abd_ocs_comments c ON c.id=cp.comment_id WHERE cp.source='user' AND cp.complied AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND (s.source_comment_id=c.source_comment_id OR s.source_parent_comment_id=c.source_comment_id))),
    'user_compliance_true_to_carry', (SELECT count(*) FROM abd_ocs_compliance cp JOIN abd_ocs_comments c ON c.id=cp.comment_id WHERE cp.source='user' AND cp.complied AND NOT EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s WHERE s.stage_run_id=p_run AND s.source_comment_id=c.source_comment_id) AND EXISTS (SELECT 1 FROM abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=p_run AND s2.source_parent_comment_id=c.source_comment_id AND s2.is_active)),
    'raw_data_ocs_corrections_after', (SELECT count(*) FROM abd_ocs_number_correction_log l JOIN abd_items_raw r ON r.abd_number=l.abd_number WHERE r.abd_ocs_no = l.ocs_no_after),
    'raw_data_ocs_corrections_total', (SELECT count(*) FROM abd_ocs_number_correction_log),
    'attachment_metrics', public.abd_ocs_v3_attachment_metrics()
  ) INTO v;

  v := v || jsonb_build_object('duplicate_active_atomic_id', 0);
  RETURN v;
END $$;

-- 6) V3 Import 본체 (멱등)
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_import(p_run uuid, p_import_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r_groups int := 0; r_ins int := 0; r_upd int := 0; r_abd int := 0;
  r_sup int := 0; r_comp int := 0; r_att int := 0; r_seg int := 0; r_seglink int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  -- 6.1 그룹 upsert (group_key = 'G:'||parent 규약 유지)
  WITH up AS (
    INSERT INTO public.abd_ocs_comment_groups AS g (
      group_key, source_parent_comment_id, ocs_number, ocs_number_norm,
      source_drawing_number, drawing_number_norm, source_file_name, source_sheet_name,
      source_row_index, atomic_item_count, contractor_response_raw, response_mapping_status, import_log_id
    )
    SELECT 'G:'||s.source_parent_comment_id, s.source_parent_comment_id,
           COALESCE(s.v3_ocs_number, s.ocs_number), public.abd_ocs_norm(COALESCE(s.v3_ocs_number, s.ocs_number)),
           s.drawing_number, public.abd_ocs_norm(s.drawing_number),
           s.source_file_name, s.source_sheet, s.source_row,
           COALESCE(s.item_count,1), s.group_contractor_response,
           CASE WHEN EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_response rr
                             WHERE rr.stage_run_id=p_run AND rr.source_parent_comment_id=s.source_parent_comment_id
                               AND rr.mapping_status IN ('requires_review','probable'))
                THEN 'group_response_open_rejected' ELSE 'inherited' END,
           p_import_log_id
    FROM public.abd_ocs_v3_stage_groups s WHERE s.stage_run_id = p_run
    ON CONFLICT (group_key) DO UPDATE SET
      ocs_number = EXCLUDED.ocs_number, ocs_number_norm = EXCLUDED.ocs_number_norm,
      source_drawing_number = EXCLUDED.source_drawing_number,
      drawing_number_norm = EXCLUDED.drawing_number_norm,
      source_file_name = EXCLUDED.source_file_name, source_sheet_name = EXCLUDED.source_sheet_name,
      source_row_index = EXCLUDED.source_row_index, atomic_item_count = EXCLUDED.atomic_item_count,
      contractor_response_raw = EXCLUDED.contractor_response_raw,
      response_mapping_status = EXCLUDED.response_mapping_status,
      import_log_id = EXCLUDED.import_log_id
    RETURNING 1
  ) SELECT count(*) INTO r_groups FROM up;

  -- 6.2 원자 코멘트 upsert (부모 속성 상속 + V3 링크 결정)
  WITH j AS (
    SELECT s.*, p.*, g.id AS group_id,
           (SELECT ar.id FROM public.abd_items_raw ar WHERE ar.abd_number = s.abd_numbers[1]) AS v3_abd_id
    FROM public.abd_ocs_v3_stage_comments s
    JOIN LATERAL (
      SELECT c.ocs_number_norm AS p_ocsnorm, c.drawing_number_norm AS p_dwgnorm, c.ocs_sn,
             c.file_revision, c.comment_revision, c.sign_off_status, c.source_modified_at,
             c.team, c.discipline, c.service, c.plot, c.project, c.source_file_hash,
             c.warning_codes, c.review_priority
      FROM public.abd_ocs_comments c WHERE c.source_comment_id = s.source_parent_comment_id
    ) p ON true
    LEFT JOIN public.abd_ocs_comment_groups g ON g.group_key = 'G:'||s.source_parent_comment_id
    WHERE s.stage_run_id = p_run
  ), up AS (
    INSERT INTO public.abd_ocs_comments AS t (
      source_comment_id, ocs_number, ocs_number_norm, source_drawing_number, drawing_number_norm,
      ocs_sn, file_revision, comment_revision, comment_part, ocs_comment, assessed_code,
      contractor_response, sign_off_status, source_file_name, source_sheet_name, source_row_index,
      source_modified_at, import_log_id, imported_at, abd_item_id, link_status, link_method, linked_at,
      team, discipline, service, plot, project, source_file_hash, warning_codes, review_priority,
      is_active, inactive_at, retired_reason, comment_group_id, source_parent_comment_id,
      atomic_item_no, atomic_item_count, split_status, response_mapping_status, v2_import_log_id
    )
    SELECT j.source_comment_id, j.ocs_number, public.abd_ocs_norm(j.ocs_number),
           j.drawing_number, public.abd_ocs_norm(j.drawing_number),
           j.ocs_sn, j.file_revision, j.comment_revision, j.comment_part, j.ocs_comment, j.assessed_code,
           j.contractor_response, j.sign_off_status, j.source_file_name, j.source_sheet_name, j.source_row_index,
           j.source_modified_at, p_import_log_id, now(),
           j.v3_abd_id,
           CASE WHEN j.v3_abd_id IS NOT NULL THEN 'linked' ELSE COALESCE(j.link_status,'unmatched') END,
           COALESCE(j.link_method,'v3_atomic'),
           CASE WHEN j.v3_abd_id IS NOT NULL THEN now() ELSE NULL END,
           j.team, j.discipline, j.service, j.plot, j.project, j.source_file_hash, j.warning_codes, j.review_priority,
           j.is_active, CASE WHEN j.is_active THEN NULL ELSE now() END, j.retired_reason,
           j.group_id, j.source_parent_comment_id,
           j.atomic_item_no, j.atomic_item_count, COALESCE(j.split_status,'atomic'), 'inherited', p_import_log_id
    FROM j
    ON CONFLICT (source_comment_id) DO UPDATE SET
      ocs_number = EXCLUDED.ocs_number, ocs_number_norm = EXCLUDED.ocs_number_norm,
      ocs_comment = EXCLUDED.ocs_comment, assessed_code = EXCLUDED.assessed_code,
      contractor_response = EXCLUDED.contractor_response, comment_part = EXCLUDED.comment_part,
      abd_item_id = EXCLUDED.abd_item_id, link_status = EXCLUDED.link_status,
      link_method = EXCLUDED.link_method, linked_at = EXCLUDED.linked_at,
      comment_group_id = EXCLUDED.comment_group_id,
      source_parent_comment_id = EXCLUDED.source_parent_comment_id,
      atomic_item_no = EXCLUDED.atomic_item_no, atomic_item_count = EXCLUDED.atomic_item_count,
      split_status = EXCLUDED.split_status, is_active = EXCLUDED.is_active,
      inactive_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE COALESCE(abd_ocs_comments.inactive_at, now()) END,
      retired_reason = EXCLUDED.retired_reason,
      is_superseded_by_v2 = false, superseded_at = NULL,
      import_log_id = EXCLUDED.import_log_id, updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO r_ins, r_upd FROM up;

  -- 6.3 ABD 다대다 연결 (linked_multi 보존)
  WITH pair AS (
    SELECT c.id AS comment_id, ar.id AS abd_item_id, n.abd_number, s.source_comment_id,
           (n.ord = 1) AS is_primary
    FROM public.abd_ocs_v3_stage_comments s
    CROSS JOIN LATERAL unnest(s.abd_numbers) WITH ORDINALITY AS n(abd_number, ord)
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.source_comment_id
    JOIN public.abd_items_raw ar ON ar.abd_number = n.abd_number
    WHERE s.stage_run_id = p_run AND s.is_active
  ), up AS (
    INSERT INTO public.abd_ocs_comment_abd_links AS l
      (comment_id, abd_item_id, abd_number, source_comment_id, is_primary, link_method, import_log_id)
    SELECT comment_id, abd_item_id, abd_number, source_comment_id, is_primary, 'v3_atomic', p_import_log_id
    FROM pair
    ON CONFLICT (comment_id, abd_item_id) DO UPDATE SET
      abd_number = EXCLUDED.abd_number, is_primary = EXCLUDED.is_primary,
      import_log_id = EXCLUDED.import_log_id, updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO r_abd FROM up;

  DELETE FROM public.abd_ocs_comment_abd_links l
   USING public.abd_ocs_v3_stage_comments s
   WHERE s.stage_run_id = p_run
     AND l.source_comment_id = s.source_comment_id
     AND NOT (l.abd_number = ANY (s.abd_numbers));

  -- 6.4 V2 부모 supersede (V3 자식이 있는데 자신은 V3 정본에 없는 활성 행)
  WITH sup AS (
    UPDATE public.abd_ocs_comments c
       SET is_active = false, is_superseded_by_v2 = true, superseded_at = now(),
           inactive_at = COALESCE(c.inactive_at, now()),
           retired_reason = COALESCE(c.retired_reason, 'superseded_by_atomic_v3'),
           updated_at = now()
     WHERE c.is_active
       AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s
                        WHERE s.stage_run_id=p_run AND s.source_comment_id=c.source_comment_id)
       AND EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s2
                    WHERE s2.stage_run_id=p_run AND s2.source_parent_comment_id=c.source_comment_id)
    RETURNING 1
  ) SELECT count(*) INTO r_sup FROM sup;

  -- 6.5 사용자 Compliance 안전 승계: complied=true 만, 자식에 행 없을 때만 (부모 행/로그 보존)
  WITH carry AS (
    INSERT INTO public.abd_ocs_compliance AS cp (comment_id, complied, source, note, updated_by)
    SELECT ch.id, true, 'user',
           'carried_from_v2_parent:'||pc.source_comment_id, pcp.updated_by
    FROM public.abd_ocs_compliance pcp
    JOIN public.abd_ocs_comments pc ON pc.id = pcp.comment_id
    JOIN public.abd_ocs_v3_stage_comments s
      ON s.stage_run_id = p_run AND s.source_parent_comment_id = pc.source_comment_id AND s.is_active
    JOIN public.abd_ocs_comments ch ON ch.source_comment_id = s.source_comment_id
    WHERE pcp.source = 'user' AND pcp.complied
      AND pc.source_comment_id <> s.source_comment_id
    ON CONFLICT (comment_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO r_comp FROM carry;

  -- 6.6 첨부 링크 (기존 confirmed 절대 downgrade 금지)
  WITH single_links AS (
    INSERT INTO public.abd_ocs_attachment_comment_links AS l
      (attachment_id, comment_id, source_attachment_id, source_comment_id, mapping_method, mapping_status, import_log_id)
    SELECT a.id, c.id, s.attachment_id, s.atomic_comment_id, 'atomic_exact', 'confirmed', p_import_log_id
    FROM public.abd_ocs_v3_stage_attachments s
    JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.atomic_comment_id
    WHERE s.stage_run_id = p_run AND s.attachment_scope = 'single' AND s.atomic_comment_id IS NOT NULL
    ON CONFLICT (attachment_id, comment_id) DO UPDATE SET
      mapping_status = 'confirmed', mapping_method = 'atomic_exact',
      import_log_id = EXCLUDED.import_log_id, updated_at = now()
    RETURNING 1
  ), group_links AS (
    INSERT INTO public.abd_ocs_attachment_comment_links AS l
      (attachment_id, comment_id, source_attachment_id, source_comment_id, mapping_method, mapping_status, import_log_id)
    SELECT a.id, c.id, s.attachment_id, sc.source_comment_id, 'group_inherited_access', 'inherited', p_import_log_id
    FROM public.abd_ocs_v3_stage_attachments s
    JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
    JOIN public.abd_ocs_v3_stage_comments sc
      ON sc.stage_run_id = p_run AND sc.source_parent_comment_id = s.source_parent_comment_id AND sc.is_active
    JOIN public.abd_ocs_comments c ON c.source_comment_id = sc.source_comment_id
    WHERE s.stage_run_id = p_run
      AND s.attachment_scope IN ('group','needs_review')
      AND s.source_parent_comment_id IS NOT NULL
    ON CONFLICT (attachment_id, comment_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM single_links) + (SELECT count(*) FROM group_links) INTO r_att;

  -- 6.7 Contractor Response 정규화 보존
  WITH seg AS (
    INSERT INTO public.abd_ocs_response_segments AS rs (
      source_parent_comment_id, response_segment_no, response_source_label, response_text,
      source_file_name, source_sheet, source_row, mapping_status, mapping_method,
      confidence_score, generic_response, import_log_id
    )
    SELECT s.source_parent_comment_id, s.response_segment_no, s.response_source_label, s.response_text,
           s.source_file_name, s.source_sheet, s.source_row,
           CASE WHEN s.mapping_status IN ('requires_review','probable')
                THEN 'group_response_open_rejected' ELSE s.mapping_status END,
           s.mapping_method, s.confidence_score, s.generic_response, p_import_log_id
    FROM public.abd_ocs_v3_stage_response s WHERE s.stage_run_id = p_run
    ON CONFLICT (source_parent_comment_id, response_segment_no) DO UPDATE SET
      response_source_label = EXCLUDED.response_source_label,
      response_text = EXCLUDED.response_text,
      source_file_name = EXCLUDED.source_file_name, source_sheet = EXCLUDED.source_sheet,
      source_row = EXCLUDED.source_row, mapping_status = EXCLUDED.mapping_status,
      mapping_method = EXCLUDED.mapping_method, confidence_score = EXCLUDED.confidence_score,
      generic_response = EXCLUDED.generic_response, import_log_id = EXCLUDED.import_log_id,
      updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO r_seg FROM seg;

  -- 6.8 confirmed_high 만 개별 atomic 연결
  WITH lk AS (
    INSERT INTO public.abd_ocs_response_comment_links AS rl (
      response_segment_id, comment_id, source_parent_comment_id, response_segment_no,
      source_comment_id, mapping_status, mapping_method, confidence_score, import_log_id
    )
    SELECT rs.id, c.id, s.source_parent_comment_id, s.response_segment_no,
           s.atomic_comment_id, 'confirmed_high', COALESCE(s.mapping_method,'v3_confirmed_high'),
           s.confidence_score, p_import_log_id
    FROM public.abd_ocs_v3_stage_response s
    JOIN public.abd_ocs_response_segments rs
      ON rs.source_parent_comment_id = s.source_parent_comment_id
     AND rs.response_segment_no = s.response_segment_no
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.atomic_comment_id
    WHERE s.stage_run_id = p_run AND s.mapping_status = 'confirmed_high'
      AND s.atomic_comment_id IS NOT NULL
    ON CONFLICT (response_segment_id, comment_id) DO UPDATE SET
      mapping_status = 'confirmed_high', mapping_method = EXCLUDED.mapping_method,
      confidence_score = EXCLUDED.confidence_score, import_log_id = EXCLUDED.import_log_id,
      updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO r_seglink FROM lk;

  -- 6.9 캐시 전량 재집계
  PERFORM public.abd_ocs_recount_all();

  RETURN jsonb_build_object(
    'groups_upserted', r_groups, 'comments_inserted', r_ins, 'comments_updated', r_upd,
    'abd_links_upserted', r_abd, 'v2_parents_superseded', r_sup,
    'compliance_carried', r_comp, 'attachment_links', r_att,
    'response_segments', r_seg, 'response_links', r_seglink
  );
END $$;

-- 7) 최종 검증
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_verify()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'comments_total', (SELECT count(*) FROM abd_ocs_comments),
    'comments_active', (SELECT count(*) FROM abd_ocs_comments WHERE is_active),
    'comments_superseded_v3', (SELECT count(*) FROM abd_ocs_comments WHERE retired_reason='superseded_by_atomic_v3'),
    'active_linked', (SELECT count(*) FROM abd_ocs_comments WHERE is_active AND link_status='linked' AND abd_item_id IS NOT NULL),
    'active_unmatched', (SELECT count(*) FROM abd_ocs_comments WHERE is_active AND (link_status IS DISTINCT FROM 'linked' OR abd_item_id IS NULL)),
    'abd_link_associations', (SELECT count(*) FROM abd_ocs_comment_abd_links l JOIN abd_ocs_comments c ON c.id=l.comment_id WHERE c.is_active),
    'distinct_linked_abd', (SELECT count(DISTINCT l.abd_item_id) FROM abd_ocs_comment_abd_links l JOIN abd_ocs_comments c ON c.id=l.comment_id WHERE c.is_active),
    'compliance_user_rows', (SELECT count(*) FROM abd_ocs_compliance WHERE source='user'),
    'compliance_log_rows', (SELECT count(*) FROM abd_ocs_compliance_log),
    'response_segments', (SELECT count(*) FROM abd_ocs_response_segments),
    'response_open_rejected', (SELECT count(*) FROM abd_ocs_response_segments WHERE mapping_status='group_response_open_rejected'),
    'response_links', (SELECT count(*) FROM abd_ocs_response_comment_links),
    'attachment_metrics', public.abd_ocs_v3_attachment_metrics(),
    'items_with_ocs_cache', (SELECT count(*) FROM abd_items_raw WHERE COALESCE(ocs_total,0) > 0)
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_v3_import(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_v3_dryrun(uuid) FROM anon;