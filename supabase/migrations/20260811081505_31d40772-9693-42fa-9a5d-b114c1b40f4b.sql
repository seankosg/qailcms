CREATE OR REPLACE FUNCTION public.spl_ocs_comments_for_spl(_spl_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT jsonb_agg(x ORDER BY x->>'ocs_number', x->>'revision',
                   (x->>'sn_order')::int, (x->>'atomic_item_no')::int)
    INTO v
  FROM (
    SELECT jsonb_build_object(
      'id', c.id,
      'source_comment_id', c.source_comment_id,
      'ocs_number', c.ocs_number,
      'revision', c.revision,
      'sn', split_part(c.source_comment_id, '|', 3),
      'sn_order', COALESCE(NULLIF(regexp_replace(split_part(c.source_comment_id,'|',3), '\D', '', 'g'), '')::int, 0),
      'doc_revision', NULLIF(split_part(c.source_comment_id, '|', 4), ''),
      'atomic_item_no', COALESCE(c.atomic_item_no, 1),
      'atomic_item_count', c.atomic_item_count,
      'comment_text', c.comment_text,
      'contractor_response', c.contractor_response,
      'assessed_code', c.assessed_code,
      'sign_off_status', c.sign_off_status,
      'is_resolved', c.is_resolved,
      'resolved_reason', c.resolved_reason,
      'response_mapping_status', c.response_mapping_status,
      'is_user_created', c.import_log_id IS NULL,
      'source_sheet', c.source_sheet,
      'source_row', c.source_row,
      'complied', COALESCE(co.complied, false),
      'complied_source', co.source,
      'complied_by_name', co.changed_by_name,
      'complied_at', co.changed_at,
      -- 원본 엑셀은 코멘트가 속한 그룹의 source_file_name 으로 연결한다.
      -- (spl_ocs_source_files.ocs_number/revision 은 미채움 컬럼이라 매칭 근거로 쓰지 않는다)
      'source_file', (
        SELECT jsonb_build_object('id', sf.id, 'file_name', sf.file_name)
          FROM public.spl_ocs_comment_groups g
          JOIN public.spl_ocs_source_files sf
            ON sf.is_active AND sf.file_name = g.source_file_name
         WHERE g.id = c.group_id
         ORDER BY sf.created_at DESC LIMIT 1),
      'attachments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path,
                                            'format', a.format, 'byte_size', a.byte_size)
                         ORDER BY a.created_at)
          FROM public.spl_ocs_attachment_comment_links al
          JOIN public.spl_ocs_attachments a ON a.id = al.attachment_id AND a.is_active
         WHERE al.comment_id = c.id), '[]'::jsonb),
      'categories', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', ct.id, 'code', ct.code, 'label', ct.label,
                                            'color', ct.color, 'source', m.source) ORDER BY ct.sort_order)
          FROM public.spl_ocs_categories_mapping m
          JOIN public.spl_ocs_categories ct ON ct.id = m.category_id
         WHERE m.comment_id = c.id), '[]'::jsonb),
      'rsp_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', r.id, 'rsp_number', r.rsp_number,
                                            'description', r.description,
                                            'mapping_method', rl.mapping_method) ORDER BY r.sort_order)
          FROM public.spl_ocs_comment_rsp_links rl
          JOIN public.spl_rsp_items r ON r.id = rl.rsp_item_id AND r.is_active
         WHERE rl.comment_id = c.id), '[]'::jsonb)
    ) AS x
    FROM public.spl_ocs_comment_spl_links l
    JOIN public.spl_ocs_comments c ON c.id = l.comment_id AND c.is_active
    LEFT JOIN public.spl_ocs_compliance co ON co.comment_id = c.id
   WHERE l.spl_item_id = _spl_item_id
  ) q;

  v := COALESCE(v, '[]'::jsonb);

  RETURN jsonb_build_object(
    'can_write', public.spl_ocs_can_manage()
                 OR public.rcl_can(auth.uid(), 'SPL', _spl_item_id, 'write'),
    'comments', v,
    'total', jsonb_array_length(v),
    'resolved', (SELECT count(*) FROM jsonb_array_elements(v) e WHERE (e->>'is_resolved')::boolean),
    'complied', (SELECT count(*) FROM jsonb_array_elements(v) e WHERE (e->>'complied')::boolean),
    'pending', (SELECT count(*) FROM jsonb_array_elements(v) e
                 WHERE NOT (e->>'is_resolved')::boolean AND NOT (e->>'complied')::boolean),
    'categories_all', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code,
                                    'label', label, 'color', color, 'is_active', is_active)
                                    ORDER BY sort_order)
                                  FROM public.spl_ocs_categories WHERE is_active), '[]'::jsonb));
END
$fn$;