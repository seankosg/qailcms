CREATE OR REPLACE FUNCTION public.spl_ocs_v1_import(p_snapshot_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_log_id uuid;
  v_src int := 0; v_grp int := 0; v_cmt int := 0; v_cmp int := 0;
  v_cat_attempted int := 0; v_cat_unique int := 0; v_cat_dup int := 0; v_cat_ins int := 0;
  v_spl int := 0; v_rsp int := 0; v_att int := 0; v_attlink int := 0;
  v_excluded jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  INSERT INTO public.spl_ocs_import_logs (package_hash, file_name, status, stage, snapshot_id)
  VALUES (
    md5((SELECT coalesce(string_agg(payload::text, '|' ORDER BY id), '') FROM public.spl_ocs_v1_stage)),
    'SPL OCS Stage 2 (spl-numeric-dot-v1)', 'running', 'import', p_snapshot_id
  )
  RETURNING id INTO v_log_id;

  -- 1) source files
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'source_file'),
  ins AS (
    INSERT INTO public.spl_ocs_source_files
      (source_file_identity, file_name, storage_path, content_hash, byte_size, import_log_id)
    SELECT DISTINCT p->>'sha256', p->>'file', p->>'path', p->>'sha256', (p->>'bytes')::bigint, v_log_id
    FROM s
    ON CONFLICT (source_file_identity) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_src FROM ins;

  -- 2) groups
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'group'),
  ins AS (
    INSERT INTO public.spl_ocs_comment_groups
      (source_group_identity, ocs_number, revision, source_file_name, source_sheet, source_row, source_hash, raw_comment_text, import_log_id)
    SELECT DISTINCT ON (p->>'identity')
      p->>'identity', p->>'ocs_number', p->>'revision', p->>'file', p->>'sheet',
      (p->>'row')::int, p->>'hash', p->>'raw', v_log_id
    FROM s
    ON CONFLICT (source_group_identity) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_grp FROM ins;

  -- 3) comments (원자 항목 단위 identity 를 고유키로 사용)
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'comment'),
  ins AS (
    INSERT INTO public.spl_ocs_comments
      (source_comment_id, group_id, ocs_number, revision, atomic_item_no, atomic_item_count,
       comment_text, contractor_response, assessed_code, sign_off_status, is_resolved,
       resolved_reason, response_mapping_status, source_sheet, source_row, source_hash, import_log_id)
    SELECT DISTINCT ON (s.p->>'identity')
      s.p->>'identity', g.id, s.p->>'ocs_number', s.p->>'revision',
      (s.p->>'no')::int, (s.p->>'cnt')::int,
      s.p->>'text', s.p->>'resp', s.p->>'code', s.p->>'signoff',
      coalesce((s.p->>'closed')::boolean, false),
      CASE WHEN coalesce((s.p->>'closed')::boolean, false) THEN 'import_signoff_closed' END,
      CASE WHEN s.p->>'resp' IS NOT NULL THEN 'mapped' ELSE 'none' END,
      s.p->>'sheet', (s.p->>'row')::int, s.p->>'hash', v_log_id
    FROM s LEFT JOIN public.spl_ocs_comment_groups g ON g.source_group_identity = s.p->>'group'
    ON CONFLICT (source_comment_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_cmt FROM ins;

  -- 4) compliance (Resolved = 준수 완료)
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'comment'),
  ins AS (
    INSERT INTO public.spl_ocs_compliance (comment_id, complied, source)
    SELECT DISTINCT c.id, coalesce((s.p->>'closed')::boolean, false), 'import_resolved'
    FROM s JOIN public.spl_ocs_comments c ON c.source_comment_id = s.p->>'identity'
    ON CONFLICT (comment_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_cmp FROM ins;

  -- 5) 카테고리 매핑 — 입력 DISTINCT + ON CONFLICT DO NOTHING + 제거된 중복 계수
  CREATE TEMP TABLE _cat_in ON COMMIT DROP AS
  SELECT c.id AS comment_id, cat.id AS category_id
  FROM public.spl_ocs_v1_stage st
  JOIN public.spl_ocs_comments c ON c.source_comment_id = st.payload->>'identity'
  CROSS JOIN LATERAL jsonb_array_elements_text(st.payload->'cats') AS t(code)
  JOIN public.spl_ocs_categories cat ON cat.code = t.code
  WHERE st.kind = 'comment';

  SELECT count(*) INTO v_cat_attempted FROM _cat_in;
  SELECT count(*) INTO v_cat_unique FROM (SELECT DISTINCT comment_id, category_id FROM _cat_in) d;
  v_cat_dup := v_cat_attempted - v_cat_unique;

  WITH ins AS (
    INSERT INTO public.spl_ocs_categories_mapping (comment_id, category_id, source)
    SELECT DISTINCT comment_id, category_id, 'initial_classifier' FROM _cat_in
    ON CONFLICT (comment_id, category_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_cat_ins FROM ins;

  -- 6) SPL 링크
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'comment'),
  ins AS (
    INSERT INTO public.spl_ocs_comment_spl_links (comment_id, spl_item_id, mapping_method, confidence)
    SELECT DISTINCT c.id, (s.p->>'spl_id')::uuid, 'ocs_number_doc_ref', 1.0
    FROM s
    JOIN public.spl_ocs_comments c ON c.source_comment_id = s.p->>'identity'
    JOIN public.spl_items i ON i.id = (s.p->>'spl_id')::uuid
    ON CONFLICT (comment_id, spl_item_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_spl FROM ins;

  -- 7) RSP 링크
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'comment'),
  ins AS (
    INSERT INTO public.spl_ocs_comment_rsp_links (comment_id, rsp_item_id, scope, mapping_method, confidence)
    SELECT DISTINCT c.id, r.id, 'single', 'description_token_unique', 1.0
    FROM s
    JOIN public.spl_ocs_comments c ON c.source_comment_id = s.p->>'identity'
    CROSS JOIN LATERAL jsonb_array_elements_text(s.p->'rsp') AS t(rid)
    JOIN public.spl_rsp_items r ON r.id = t.rid::uuid
    ON CONFLICT (comment_id, rsp_item_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_rsp FROM ins;

  -- 8) 첨부 + 코멘트 링크
  WITH s AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'attachment'),
  ins AS (
    INSERT INTO public.spl_ocs_attachments
      (source_attachment_identity, storage_path, content_hash, byte_size, format,
       source_file_name, source_sheet, source_anchor, import_log_id)
    SELECT DISTINCT ON (p->>'hash')
      p->>'hash', p->>'path', p->>'hash', (p->>'bytes')::bigint, ltrim(p->>'ext', '.'),
      p->>'file', p->>'sheet', p->>'anchor', v_log_id
    FROM s
    ON CONFLICT (source_attachment_identity) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_att FROM ins;

  WITH g AS (SELECT payload p FROM public.spl_ocs_v1_stage WHERE kind = 'group'),
  ins AS (
    INSERT INTO public.spl_ocs_attachment_comment_links (attachment_id, comment_id, mapping_method, scope, confidence)
    SELECT DISTINCT a.id, c.id, 'group_anchor', 'group', 1.0
    FROM g
    CROSS JOIN LATERAL jsonb_array_elements_text(g.p->'attachments') AS t(hash)
    JOIN public.spl_ocs_attachments a ON a.source_attachment_identity = t.hash
    JOIN public.spl_ocs_comment_groups grp ON grp.source_group_identity = g.p->>'identity'
    JOIN public.spl_ocs_comments c ON c.group_id = grp.id
    ON CONFLICT (attachment_id, comment_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_attlink FROM ins;

  SELECT coalesce(payload->'rows', '[]'::jsonb) INTO v_excluded
  FROM public.spl_ocs_v1_stage WHERE kind = 'excluded' LIMIT 1;

  v_result := jsonb_build_object(
    'import_log_id', v_log_id,
    'source_files', v_src,
    'groups', v_grp,
    'comments', v_cmt,
    'compliance', v_cmp,
    'category_attempted_rows', v_cat_attempted,
    'category_unique_pairs', v_cat_unique,
    'category_duplicate_input_rows_removed', v_cat_dup,
    'category_inserted', v_cat_ins,
    'category_identity_ok', (v_cat_unique = v_cat_attempted - v_cat_dup),
    'spl_links', v_spl,
    'rsp_links', v_rsp,
    'attachments', v_att,
    'attachment_comment_links', v_attlink,
    'excluded_rows', jsonb_array_length(v_excluded)
  );

  UPDATE public.spl_ocs_import_logs
     SET status = CASE WHEN p_dry_run THEN 'confirmed_rollback' ELSE 'success' END,
         stage = 'done',
         counts = v_result,
         result = v_result,
         warnings = jsonb_build_array(jsonb_build_object(
           'code', 'category_duplicate_pairs_removed',
           'removed_rows', v_cat_dup,
           'attempted_rows', v_cat_attempted,
           'unique_pairs', v_cat_unique
         )) || jsonb_build_array(jsonb_build_object('code','excluded_rows','rows', v_excluded)),
         finished_at = now()
   WHERE id = v_log_id;

  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY_RUN_ROLLBACK %', v_result::text;
  END IF;

  PERFORM public.spl_ocs_recount_all_internal();

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.spl_ocs_v1_import(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spl_ocs_v1_import(uuid, boolean) TO service_role;