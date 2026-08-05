CREATE OR REPLACE FUNCTION public.abd_ocs_v3_import(p_run uuid, p_import_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r_groups int := 0; r_ins int := 0; r_upd int := 0; r_abd int := 0;
  r_sup int := 0; r_comp int := 0; r_att int := 0; r_seg int := 0; r_seglink int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

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

  WITH j AS (
    SELECT s.*, p.*, g.id AS group_id,
           (SELECT ar.id FROM public.abd_items_raw ar WHERE ar.abd_number = s.abd_numbers[1]) AS v3_abd_id
    FROM public.abd_ocs_v3_stage_comments s
    JOIN LATERAL (
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
      inactive_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE COALESCE(t.inactive_at, now()) END,
      retired_reason = EXCLUDED.retired_reason,
      is_superseded_by_v2 = false, superseded_at = NULL,
      import_log_id = EXCLUDED.import_log_id, updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO r_ins, r_upd FROM up;

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
    'groups_upserted', r_groups, 'comments_inserted', r_ins, 'comments_updated', r_upd,
    'abd_links_upserted', r_abd, 'v2_parents_superseded', r_sup,
    'compliance_carried', r_comp, 'attachment_links', r_att,
    'response_segments', r_seg, 'response_links', r_seglink
  );
END $function$;