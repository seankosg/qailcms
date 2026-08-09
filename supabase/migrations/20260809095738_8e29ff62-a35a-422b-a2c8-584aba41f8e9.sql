-- ── 1) abd_ocs_v3_import: 항등식 8종 추가 ────────────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_import(p_run uuid, p_import_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r_groups int := 0; r_ins int := 0; r_upd int := 0; r_abd int := 0;
  r_sup int := 0; r_comp int := 0; r_att int := 0; r_seg int := 0; r_seglink int := 0;
  r_staged int := 0; r_staged_groups int := 0; r_staged_active int := 0;
  r_staged_assoc int := 0; r_staged_seg int := 0;
  r_active_now int := 0; r_unresolved int := 0; r_dup_scid int := 0;
  r_exp_attlink int := 0; r_have_attlink int := 0; r_dup_pair int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  SELECT count(*) INTO r_staged_groups FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id = p_run;
  SELECT count(*), count(*) FILTER (WHERE is_active), COALESCE(sum(CASE WHEN is_active THEN cardinality(abd_numbers) ELSE 0 END),0)
    INTO r_staged, r_staged_active, r_staged_assoc
    FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = p_run;
  SELECT count(*) INTO r_staged_seg FROM public.abd_ocs_v3_stage_response WHERE stage_run_id = p_run;

  -- 검산 7: staged 활성 source_comment_id 중복
  SELECT count(*) INTO r_dup_scid FROM (
    SELECT source_comment_id FROM public.abd_ocs_v3_stage_comments
     WHERE stage_run_id = p_run AND is_active
     GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF r_dup_scid <> 0 THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: duplicate active staged source_comment_id (%)', r_dup_scid;
  END IF;

  -- 검산 6: 미해결 ABD number
  SELECT count(*) INTO r_unresolved
    FROM public.abd_ocs_v3_stage_comments s
    CROSS JOIN LATERAL unnest(s.abd_numbers) n(abd_number)
   WHERE s.stage_run_id = p_run AND s.is_active
     AND NOT EXISTS (SELECT 1 FROM public.abd_items_raw ar WHERE ar.abd_number = n.abd_number);
  IF r_unresolved <> 0 THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: unresolved ABD numbers (%)', r_unresolved;
  END IF;

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

  -- 검산 1
  IF r_groups <> r_staged_groups THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: staged groups (%) <> processed groups (%)', r_staged_groups, r_groups;
  END IF;

  WITH j AS (
    SELECT s.*, p.*, g.id AS group_id,
           (SELECT ar.id FROM public.abd_items_raw ar WHERE ar.abd_number = s.abd_numbers[1]) AS v3_abd_id
    FROM public.abd_ocs_v3_stage_comments s
    LEFT JOIN LATERAL (
      SELECT c.ocs_sn, c.file_revision, c.comment_revision, c.sign_off_status, c.source_modified_at,
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
           j.team, j.discipline, j.service, j.plot, j.project, j.source_file_hash,
           COALESCE(j.warning_codes, '{}'::text[]), j.review_priority,
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
      inactive_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE COALESCE(t.inactive_at, now()) END,
      retired_reason = EXCLUDED.retired_reason,
      is_superseded_by_v2 = false, superseded_at = NULL,
      import_log_id = EXCLUDED.import_log_id, updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO r_ins, r_upd FROM up;

  IF r_ins + r_upd <> r_staged THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: staged comments (%) <> inserted (%) + updated (%)', r_staged, r_ins, r_upd;
  END IF;

  -- 검산 2: staged 활성 코멘트 = 정본에서 활성 상태로 존재
  SELECT count(*) INTO r_active_now
    FROM public.abd_ocs_v3_stage_comments s
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.source_comment_id
   WHERE s.stage_run_id = p_run AND s.is_active AND c.is_active;
  IF r_active_now <> r_staged_active THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: staged active comments (%) <> active comments in DB (%)', r_staged_active, r_active_now;
  END IF;

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

  -- 검산 3
  IF r_abd <> r_staged_assoc THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: staged ABD associations (%) <> upserted links (%)', r_staged_assoc, r_abd;
  END IF;

  DELETE FROM public.abd_ocs_comment_abd_links l
   USING public.abd_ocs_v3_stage_comments s
   WHERE s.stage_run_id = p_run
     AND l.source_comment_id = s.source_comment_id
     AND NOT (l.abd_number = ANY (s.abd_numbers));

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

  WITH carry AS (
    INSERT INTO public.abd_ocs_compliance AS cp
      (comment_id, complied, source, complied_by, complied_by_name, complied_at, updated_by, updated_by_name)
    SELECT ch.id, true, 'user', pcp.complied_by, pcp.complied_by_name,
           COALESCE(pcp.complied_at, now()), pcp.updated_by, pcp.updated_by_name
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

  -- 검산 5: 기대 첨부-코멘트 연결쌍이 모두 존재
  WITH exp AS (
    SELECT a.id AS attachment_id, c.id AS comment_id
      FROM public.abd_ocs_v3_stage_attachments s
      JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
      JOIN public.abd_ocs_comments c ON c.source_comment_id = s.atomic_comment_id
     WHERE s.stage_run_id = p_run AND s.attachment_scope = 'single' AND s.atomic_comment_id IS NOT NULL
    UNION
    SELECT a.id, c.id
      FROM public.abd_ocs_v3_stage_attachments s
      JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
      JOIN public.abd_ocs_v3_stage_comments sc
        ON sc.stage_run_id = p_run AND sc.source_parent_comment_id = s.source_parent_comment_id AND sc.is_active
      JOIN public.abd_ocs_comments c ON c.source_comment_id = sc.source_comment_id
     WHERE s.stage_run_id = p_run AND s.attachment_scope IN ('group','needs_review')
       AND s.source_parent_comment_id IS NOT NULL
  )
  SELECT (SELECT count(*) FROM exp),
         (SELECT count(*) FROM exp e JOIN public.abd_ocs_attachment_comment_links l
            ON l.attachment_id = e.attachment_id AND l.comment_id = e.comment_id)
    INTO r_exp_attlink, r_have_attlink;
  IF r_exp_attlink <> r_have_attlink THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: expected attachment-comment links (%) <> present (%)', r_exp_attlink, r_have_attlink;
  END IF;

  -- 검산 8: 첨부/코멘트 중복쌍
  SELECT count(*) INTO r_dup_pair FROM (
    SELECT attachment_id, comment_id FROM public.abd_ocs_attachment_comment_links
     GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF r_dup_pair <> 0 THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: duplicate attachment/comment pairs (%)', r_dup_pair;
  END IF;

  WITH seg AS (
    INSERT INTO public.abd_ocs_response_segments AS rs (
      source_parent_comment_id, comment_group_id, response_segment_no, response_source_label,
      response_text, source_file_name, source_sheet, source_row, source_hash, import_log_id, is_active
    )
    SELECT s.source_parent_comment_id, g.id, s.response_segment_no, s.response_source_label,
           s.response_text, s.source_file_name, s.source_sheet, s.source_row,
           md5(s.source_parent_comment_id||'|'||s.response_segment_no||'|'||COALESCE(s.response_text,'')),
           p_import_log_id, true
    FROM public.abd_ocs_v3_stage_response s
    LEFT JOIN public.abd_ocs_comment_groups g ON g.group_key = 'G:'||s.source_parent_comment_id
    WHERE s.stage_run_id = p_run
    ON CONFLICT (source_parent_comment_id, response_segment_no, source_hash) DO UPDATE SET
      comment_group_id = EXCLUDED.comment_group_id,
      response_source_label = EXCLUDED.response_source_label,
      source_file_name = EXCLUDED.source_file_name, source_sheet = EXCLUDED.source_sheet,
      source_row = EXCLUDED.source_row, import_log_id = EXCLUDED.import_log_id,
      is_active = true, updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO r_seg FROM seg;

  -- 검산 4
  IF r_seg <> r_staged_seg THEN
    RAISE EXCEPTION 'abd_ocs_v3_import: staged response segments (%) <> processed (%)', r_staged_seg, r_seg;
  END IF;

  WITH lk AS (
    INSERT INTO public.abd_ocs_response_comment_links AS rl (
      response_segment_id, atomic_comment_id, source_atomic_comment_id,
      mapping_status, mapping_method, confidence_score, import_log_id, is_active
    )
    SELECT rs.id, c.id, s.atomic_comment_id, 'confirmed_high',
           COALESCE(s.mapping_method,'v3_confirmed_high'), s.confidence_score, p_import_log_id, true
    FROM public.abd_ocs_v3_stage_response s
    JOIN public.abd_ocs_response_segments rs
      ON rs.source_parent_comment_id = s.source_parent_comment_id
     AND rs.response_segment_no = s.response_segment_no
     AND rs.source_hash = md5(s.source_parent_comment_id||'|'||s.response_segment_no||'|'||COALESCE(s.response_text,''))
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.atomic_comment_id
    WHERE s.stage_run_id = p_run AND s.mapping_status = 'confirmed_high'
      AND s.atomic_comment_id IS NOT NULL
    ON CONFLICT (response_segment_id, atomic_comment_id) DO UPDATE SET
      mapping_status = 'confirmed_high', mapping_method = EXCLUDED.mapping_method,
      confidence_score = EXCLUDED.confidence_score, import_log_id = EXCLUDED.import_log_id,
      is_active = true, updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO r_seglink FROM lk;

  PERFORM public.abd_ocs_recount_all();

  RETURN jsonb_build_object(
    'groups_upserted', r_groups, 'staged_comments', r_staged,
    'comments_inserted', r_ins, 'comments_updated', r_upd,
    'abd_links_upserted', r_abd, 'v2_parents_superseded', r_sup,
    'compliance_carried', r_comp, 'attachment_links', r_att,
    'response_segments', r_seg, 'response_links', r_seglink,
    'identities', jsonb_build_object(
      'staged_groups', r_staged_groups, 'staged_active_comments', r_staged_active,
      'active_comments_in_db', r_active_now, 'staged_abd_associations', r_staged_assoc,
      'staged_response_segments', r_staged_seg,
      'expected_attachment_links', r_exp_attlink, 'present_attachment_links', r_have_attlink,
      'unresolved_abd_numbers', r_unresolved, 'duplicate_active_source_comment_id', r_dup_scid,
      'duplicate_attachment_comment_pairs', r_dup_pair
    )
  );
END $function$;

-- ── 2) 이번 사고 전용 사전조건 검사 (읽기 전용) ──────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_recover_20260809_precheck()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c_log constant uuid := 'b558b4bb-69ad-46aa-990e-f55652d72888';
  c_run constant uuid := '4900545d-f945-43e8-bcda-f78ba9a0f50e';
  v jsonb; ok boolean;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'comments_inserted', (SELECT count(*) FROM public.abd_ocs_comments WHERE import_log_id = c_log),
    'groups_inserted', (SELECT count(*) FROM public.abd_ocs_comment_groups WHERE import_log_id = c_log),
    'response_segments_inserted', (SELECT count(*) FROM public.abd_ocs_response_segments WHERE import_log_id = c_log),
    'abd_links', (SELECT count(*) FROM public.abd_ocs_comment_abd_links WHERE import_log_id = c_log),
    'attachment_links', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links WHERE import_log_id = c_log),
    'response_links', (SELECT count(*) FROM public.abd_ocs_response_comment_links WHERE import_log_id = c_log),
    'staged_comments', (SELECT count(*) FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = c_run),
    'staged_groups', (SELECT count(*) FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id = c_run),
    'staged_attachments', (SELECT count(*) FROM public.abd_ocs_v3_stage_attachments WHERE stage_run_id = c_run),
    'staged_response', (SELECT count(*) FROM public.abd_ocs_v3_stage_response WHERE stage_run_id = c_run),
    'outside_scope_hash', public.abd_ocs_inc_outside_hash(c_run)
  ) INTO v;
  ok := (v->>'comments_inserted')::int = 0
    AND (v->>'groups_inserted')::int = 185
    AND (v->>'response_segments_inserted')::int = 26
    AND (v->>'abd_links')::int = 0
    AND (v->>'attachment_links')::int = 0
    AND (v->>'response_links')::int = 0
    AND (v->>'staged_comments')::int = 333
    AND (v->>'staged_groups')::int = 185
    AND (v->>'staged_attachments')::int = 667
    AND (v->>'staged_response')::int = 26;
  RETURN v || jsonb_build_object('precondition_ok', ok);
END $function$;

-- ── 3) 복구 Dry-run (읽기 전용, 아무것도 쓰지 않음) ──────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_recover_20260809_dryrun()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c_run constant uuid := '4900545d-f945-43e8-bcda-f78ba9a0f50e';
  v_pre jsonb; v_new int; v_upd int; v_assoc int; v_attlink int; v_rlink int;
  v_sup int; v_comp int; v_unres int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  v_pre := public.abd_ocs_recover_20260809_precheck();

  SELECT count(*) FILTER (WHERE c.id IS NULL), count(*) FILTER (WHERE c.id IS NOT NULL)
    INTO v_new, v_upd
    FROM public.abd_ocs_v3_stage_comments s
    LEFT JOIN public.abd_ocs_comments c ON c.source_comment_id = s.source_comment_id
   WHERE s.stage_run_id = c_run;

  SELECT COALESCE(sum(cardinality(abd_numbers)),0) INTO v_assoc
    FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = c_run AND is_active;

  SELECT count(*) INTO v_unres
    FROM public.abd_ocs_v3_stage_comments s
    CROSS JOIN LATERAL unnest(s.abd_numbers) n(abd_number)
   WHERE s.stage_run_id = c_run AND s.is_active
     AND NOT EXISTS (SELECT 1 FROM public.abd_items_raw ar WHERE ar.abd_number = n.abd_number);

  WITH exp AS (
    SELECT a.id AS attachment_id, s.atomic_comment_id AS scid
      FROM public.abd_ocs_v3_stage_attachments s
      JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
     WHERE s.stage_run_id = c_run AND s.attachment_scope = 'single' AND s.atomic_comment_id IS NOT NULL
    UNION
    SELECT a.id, sc.source_comment_id
      FROM public.abd_ocs_v3_stage_attachments s
      JOIN public.abd_ocs_attachments a ON a.source_attachment_id = s.attachment_id
      JOIN public.abd_ocs_v3_stage_comments sc
        ON sc.stage_run_id = c_run AND sc.source_parent_comment_id = s.source_parent_comment_id AND sc.is_active
     WHERE s.stage_run_id = c_run AND s.attachment_scope IN ('group','needs_review')
       AND s.source_parent_comment_id IS NOT NULL
  ) SELECT count(*) INTO v_attlink FROM exp;

  SELECT count(*) INTO v_rlink FROM public.abd_ocs_v3_stage_response
   WHERE stage_run_id = c_run AND mapping_status = 'confirmed_high' AND atomic_comment_id IS NOT NULL;

  SELECT count(*) INTO v_sup
    FROM public.abd_ocs_comments c
   WHERE c.is_active
     AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s WHERE s.stage_run_id=c_run AND s.source_comment_id=c.source_comment_id)
     AND EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s2 WHERE s2.stage_run_id=c_run AND s2.source_parent_comment_id=c.source_comment_id);

  SELECT count(*) INTO v_comp
    FROM public.abd_ocs_compliance pcp
    JOIN public.abd_ocs_comments pc ON pc.id = pcp.comment_id
    JOIN public.abd_ocs_v3_stage_comments s
      ON s.stage_run_id = c_run AND s.source_parent_comment_id = pc.source_comment_id AND s.is_active
   WHERE pcp.source = 'user' AND pcp.complied AND pc.source_comment_id <> s.source_comment_id;

  RETURN jsonb_build_object(
    'stage_run_id', c_run,
    'precheck', v_pre,
    'comments_to_insert', v_new,
    'comments_to_update', v_upd,
    'abd_links_expected', v_assoc,
    'attachment_links_expected', v_attlink,
    'response_links_expected', v_rlink,
    'groups_idempotent_upsert', (SELECT count(*) FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id=c_run),
    'response_segments_idempotent_upsert', (SELECT count(*) FROM public.abd_ocs_v3_stage_response WHERE stage_run_id=c_run),
    'compliance_carry_expected', v_comp,
    'existing_comments_to_supersede', v_sup,
    'unresolved_abd_numbers', v_unres,
    'outside_scope_hash_before', public.abd_ocs_inc_outside_hash(c_run),
    'totals_before', jsonb_build_object(
      'comments', (SELECT count(*) FROM public.abd_ocs_comments),
      'groups', (SELECT count(*) FROM public.abd_ocs_comment_groups),
      'abd_links', (SELECT count(*) FROM public.abd_ocs_comment_abd_links),
      'attachment_links', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links),
      'response_segments', (SELECT count(*) FROM public.abd_ocs_response_segments),
      'response_links', (SELECT count(*) FROM public.abd_ocs_response_comment_links)
    )
  );
END $function$;

-- ── 4) 이번 사고 전용 일회성 복구 (단일 트랜잭션) ────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_recover_20260809(p_recovery_log_id uuid, p_snapshot_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c_log constant uuid := 'b558b4bb-69ad-46aa-990e-f55652d72888';
  c_run constant uuid := '4900545d-f945-43e8-bcda-f78ba9a0f50e';
  v_pre jsonb; v_before jsonb; v_after jsonb; v_res jsonb; v_hash_before jsonb; v_hash_after jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  v_pre := public.abd_ocs_recover_20260809_precheck();
  IF NOT (v_pre->>'precondition_ok')::boolean THEN
    RAISE EXCEPTION 'abd_ocs_recover_20260809: precondition mismatch %', v_pre::text;
  END IF;
  IF p_recovery_log_id = c_log THEN
    RAISE EXCEPTION 'abd_ocs_recover_20260809: recovery log id must differ from the original import log';
  END IF;

  v_hash_before := public.abd_ocs_inc_outside_hash(c_run);
  v_before := jsonb_build_object(
    'comments', (SELECT count(*) FROM public.abd_ocs_comments),
    'groups', (SELECT count(*) FROM public.abd_ocs_comment_groups),
    'abd_links', (SELECT count(*) FROM public.abd_ocs_comment_abd_links),
    'attachment_links', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links),
    'response_segments', (SELECT count(*) FROM public.abd_ocs_response_segments),
    'response_links', (SELECT count(*) FROM public.abd_ocs_response_comment_links)
  );

  v_res := public.abd_ocs_v3_import(c_run, p_recovery_log_id);

  v_hash_after := public.abd_ocs_inc_outside_hash(c_run);
  v_after := jsonb_build_object(
    'comments', (SELECT count(*) FROM public.abd_ocs_comments),
    'groups', (SELECT count(*) FROM public.abd_ocs_comment_groups),
    'abd_links', (SELECT count(*) FROM public.abd_ocs_comment_abd_links),
    'attachment_links', (SELECT count(*) FROM public.abd_ocs_attachment_comment_links),
    'response_segments', (SELECT count(*) FROM public.abd_ocs_response_segments),
    'response_links', (SELECT count(*) FROM public.abd_ocs_response_comment_links)
  );

  IF v_hash_before IS DISTINCT FROM v_hash_after THEN
    RAISE EXCEPTION 'abd_ocs_recover_20260809: outside-scope hash changed % -> %', v_hash_before::text, v_hash_after::text;
  END IF;

  RETURN jsonb_build_object(
    'recovery_of_import_log_id', c_log,
    'recovery_stage_run_id', c_run,
    'snapshot_id', p_snapshot_id,
    'before', v_before,
    'after', v_after,
    'import', v_res,
    'identities', v_res->'identities',
    'outside_scope_hash_before', v_hash_before,
    'outside_scope_hash_after', v_hash_after,
    'verify', public.abd_ocs_v3_verify()
  );
END $function$;