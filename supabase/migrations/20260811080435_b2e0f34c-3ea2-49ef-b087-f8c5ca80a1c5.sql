-- =========================================================
-- 1) 캐시 재계산식 교정 (pending 이중 차감 제거)
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_recount_all_internal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  WITH agg AS (
    SELECT i.id,
      COALESCE(c.total,0) t, COALESCE(c.resolved,0) r, COALESCE(c.complied,0) cp,
      COALESCE(c.pending,0) pd, COALESCE(rs.n,0) rn, COALESCE(d.n,0) dn
    FROM public.spl_items i
    LEFT JOIN (
      SELECT l.spl_item_id,
             count(*) FILTER (WHERE cm.is_active) total,
             count(*) FILTER (WHERE cm.is_active AND cm.is_resolved) resolved,
             count(*) FILTER (WHERE cm.is_active AND COALESCE(co.complied,false)) complied,
             count(*) FILTER (WHERE cm.is_active AND NOT cm.is_resolved
                              AND NOT COALESCE(co.complied,false)) pending
      FROM public.spl_ocs_comment_spl_links l
      JOIN public.spl_ocs_comments cm ON cm.id = l.comment_id
      LEFT JOIN public.spl_ocs_compliance co ON co.comment_id = cm.id
      GROUP BY l.spl_item_id
    ) c ON c.spl_item_id = i.id
    LEFT JOIN (SELECT spl_item_id, count(*) n FROM public.spl_rsp_items WHERE is_active GROUP BY 1) rs ON rs.spl_item_id = i.id
    LEFT JOIN (SELECT spl_item_id, count(*) n FROM public.spl_document_item_links GROUP BY 1) d ON d.spl_item_id = i.id
  )
  UPDATE public.spl_items i
     SET ocs_total = a.t, ocs_complied = a.cp, ocs_pending = a.pd,
         ocs_check = a.r, rsp_total = a.rn, document_total = a.dn
    FROM agg a
   WHERE a.id = i.id
     AND (i.ocs_total, i.ocs_complied, i.ocs_pending, i.ocs_check, i.rsp_total, i.document_total)
         IS DISTINCT FROM (a.t, a.cp, a.pd, a.r, a.rn, a.dn);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('updated_rows', n, 'at', now());
END $function$;

SELECT public.spl_ocs_recount_all_internal();

-- =========================================================
-- 2) 쓰기 권한 정본 (코멘트 단위)
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_can_write_comment(_comment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.spl_ocs_can_manage()
    OR EXISTS (SELECT 1 FROM public.spl_ocs_comment_spl_links l
                WHERE l.comment_id = _comment_id
                  AND public.rcl_can(auth.uid(), 'SPL', l.spl_item_id, 'write'))
  )
$function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_log(_item_id uuid, _row_id uuid, _table text,
  _action text, _column text, _old text, _new text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.spl_change_log(table_name, row_id, item_id, spl_number, action,
                                    column_name, old_value, new_value, source, changed_by)
  SELECT _table, _row_id, _item_id, (SELECT spl_number FROM public.spl_items WHERE id = _item_id),
         _action, _column, _old, _new, 'user', auth.uid();
$function$;

-- =========================================================
-- 3) 읽기: 항목별 OCS 코멘트
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_comments_for_spl(_spl_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'source_file', (
        SELECT jsonb_build_object('id', sf.id, 'file_name', sf.file_name)
          FROM public.spl_ocs_source_files sf
         WHERE sf.is_active AND sf.ocs_number = c.ocs_number
           AND COALESCE(sf.revision,'') = COALESCE(c.revision,'')
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
END $function$;

-- =========================================================
-- 4) 읽기: 항목별 RSP
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_rsp_for_spl(_spl_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'rsp_number', r.rsp_number, 'sort_order', r.sort_order,
      'description', r.description, 'manufacturer', r.manufacturer,
      'model_or_unique_id', r.model_or_unique_id, 'unit', r.unit,
      'qty_required', r.qty_required, 'qty_available', r.qty_available, 'qty_short', r.qty_short,
      'source_sheet', r.source_sheet, 'source_row', r.source_row,
      'is_user_created', r.import_log_id IS NULL,
      'ocs_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('comment_id', c.id, 'ocs_number', c.ocs_number,
                                            'revision', c.revision,
                                            'sn', split_part(c.source_comment_id,'|',3),
                                            'mapping_method', rl.mapping_method) ORDER BY c.ocs_number)
          FROM public.spl_ocs_comment_rsp_links rl
          JOIN public.spl_ocs_comments c ON c.id = rl.comment_id AND c.is_active
         WHERE rl.rsp_item_id = r.id), '[]'::jsonb)
    ) ORDER BY r.sort_order, r.rsp_number)
    INTO v
    FROM public.spl_rsp_items r
   WHERE r.spl_item_id = _spl_item_id AND r.is_active;
  v := COALESCE(v, '[]'::jsonb);
  RETURN jsonb_build_object(
    'can_write', public.spl_ocs_can_manage()
                 OR public.rcl_can(auth.uid(), 'SPL', _spl_item_id, 'write'),
    'rows', v, 'total', jsonb_array_length(v));
END $function$;

-- =========================================================
-- 5) 편집: Complied
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_set_complied(_comment_id uuid, _expected boolean, _complied boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cur boolean; v_resolved boolean; v_name text; v_item uuid;
BEGIN
  IF NOT public.spl_ocs_can_write_comment(_comment_id) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT c.is_resolved INTO v_resolved FROM public.spl_ocs_comments c
   WHERE c.id = _comment_id AND c.is_active;
  IF v_resolved IS NULL THEN RAISE EXCEPTION 'comment not found'; END IF;
  IF v_resolved THEN RAISE EXCEPTION 'resolved comment is read-only'; END IF;

  SELECT COALESCE(complied,false) INTO v_cur FROM public.spl_ocs_compliance WHERE comment_id = _comment_id;
  v_cur := COALESCE(v_cur, false);
  IF v_cur IS DISTINCT FROM COALESCE(_expected,false) THEN
    RAISE EXCEPTION 'stale update: current=%', v_cur;
  END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.spl_ocs_compliance(comment_id, complied, source, changed_by, changed_by_name, changed_at)
  VALUES (_comment_id, _complied, 'user', auth.uid(), v_name, now())
  ON CONFLICT (comment_id) DO UPDATE
    SET complied = EXCLUDED.complied, source = 'user', changed_by = EXCLUDED.changed_by,
        changed_by_name = EXCLUDED.changed_by_name, changed_at = now(), updated_at = now();

  INSERT INTO public.spl_ocs_compliance_log(comment_id, old_value, new_value, source, changed_by, changed_by_name)
  VALUES (_comment_id, v_cur, _complied, 'user', auth.uid(), v_name);

  SELECT l.spl_item_id INTO v_item FROM public.spl_ocs_comment_spl_links l WHERE l.comment_id = _comment_id LIMIT 1;
  PERFORM public.spl_ocs_log(v_item, _comment_id, 'spl_ocs_compliance', 'update', 'complied',
                             v_cur::text, _complied::text);
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true, 'complied', _complied);
END $function$;

-- =========================================================
-- 6) 편집: Category
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_set_category(_comment_id uuid, _category_id uuid, _on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item uuid; v_code text;
BEGIN
  IF NOT public.spl_ocs_can_write_comment(_comment_id) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT code INTO v_code FROM public.spl_ocs_categories WHERE id = _category_id;
  IF v_code IS NULL THEN RAISE EXCEPTION 'category not found'; END IF;
  SELECT l.spl_item_id INTO v_item FROM public.spl_ocs_comment_spl_links l WHERE l.comment_id = _comment_id LIMIT 1;
  IF _on THEN
    INSERT INTO public.spl_ocs_categories_mapping(comment_id, category_id, source, confidence)
    VALUES (_comment_id, _category_id, 'user', 1)
    ON CONFLICT (comment_id, category_id) DO NOTHING;
    PERFORM public.spl_ocs_log(v_item, _comment_id, 'spl_ocs_categories_mapping', 'insert', 'category', NULL, v_code);
  ELSE
    DELETE FROM public.spl_ocs_categories_mapping WHERE comment_id = _comment_id AND category_id = _category_id;
    PERFORM public.spl_ocs_log(v_item, _comment_id, 'spl_ocs_categories_mapping', 'delete', 'category', v_code, NULL);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_upsert_category(_id uuid, _code text, _label text, _is_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.spl_ocs_can_manage() THEN RAISE EXCEPTION 'permission denied'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.spl_ocs_categories(code, label, is_active, is_user_created, sort_order)
    VALUES (lower(regexp_replace(COALESCE(NULLIF(trim(_code),''), _label), '\W+', '_', 'g')),
            trim(_label), COALESCE(_is_active,true), true,
            COALESCE((SELECT max(sort_order)+1 FROM public.spl_ocs_categories), 1))
    RETURNING id INTO v_id;
    PERFORM public.spl_ocs_log(NULL, v_id, 'spl_ocs_categories', 'insert', 'label', NULL, trim(_label));
  ELSE
    UPDATE public.spl_ocs_categories
       SET label = COALESCE(NULLIF(trim(_label),''), label),
           is_active = COALESCE(_is_active, is_active), updated_at = now()
     WHERE id = _id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'category not found'; END IF;
    PERFORM public.spl_ocs_log(NULL, v_id, 'spl_ocs_categories', 'update', 'label', NULL, trim(_label));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- =========================================================
-- 7) 편집: OCS 코멘트
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_ocs_upsert_comment(
  _id uuid, _spl_item_id uuid, _ocs_number text, _revision text,
  _comment_text text, _contractor_response text, _assessed_code text, _sign_off_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_old text;
BEGIN
  IF _id IS NULL THEN
    IF NOT (public.spl_ocs_can_manage()
            OR public.rcl_can(auth.uid(), 'SPL', _spl_item_id, 'write')) THEN
      RAISE EXCEPTION 'permission denied';
    END IF;
    INSERT INTO public.spl_ocs_comments(source_comment_id, ocs_number, revision, atomic_item_no,
      atomic_item_count, comment_text, contractor_response, assessed_code, sign_off_status,
      is_resolved, is_active)
    VALUES ('user:'||gen_random_uuid()::text, NULLIF(trim(_ocs_number),''), NULLIF(trim(_revision),''),
            1, 1, _comment_text, _contractor_response, NULLIF(trim(_assessed_code),''),
            NULLIF(trim(_sign_off_status),''), false, true)
    RETURNING id INTO v_id;
    INSERT INTO public.spl_ocs_comment_spl_links(comment_id, spl_item_id, mapping_method, confidence)
    VALUES (v_id, _spl_item_id, 'user', 1);
    PERFORM public.spl_ocs_log(_spl_item_id, v_id, 'spl_ocs_comments', 'insert', 'comment_text', NULL, _comment_text);
  ELSE
    IF NOT public.spl_ocs_can_write_comment(_id) THEN RAISE EXCEPTION 'permission denied'; END IF;
    SELECT comment_text INTO v_old FROM public.spl_ocs_comments WHERE id = _id;
    -- source identity(source_comment_id/group/hash)는 사용자 편집 대상이 아니다
    UPDATE public.spl_ocs_comments
       SET comment_text = COALESCE(_comment_text, comment_text),
           contractor_response = _contractor_response,
           assessed_code = NULLIF(trim(_assessed_code),''),
           sign_off_status = NULLIF(trim(_sign_off_status),''),
           updated_at = now()
     WHERE id = _id AND is_active RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'comment not found'; END IF;
    PERFORM public.spl_ocs_log(_spl_item_id, v_id, 'spl_ocs_comments', 'update', 'comment_text', v_old, _comment_text);
  END IF;
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_deactivate_comment(_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item uuid;
BEGIN
  IF NOT public.spl_ocs_can_write_comment(_id) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT l.spl_item_id INTO v_item FROM public.spl_ocs_comment_spl_links l WHERE l.comment_id = _id LIMIT 1;
  UPDATE public.spl_ocs_comments SET is_active = false, updated_at = now() WHERE id = _id;
  PERFORM public.spl_ocs_log(v_item, _id, 'spl_ocs_comments', 'deactivate', 'is_active', 'true',
                             COALESCE(_reason,'user deactivate'));
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_set_rsp_link(_comment_id uuid, _rsp_item_id uuid, _on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item uuid; v_num text;
BEGIN
  IF NOT public.spl_ocs_can_write_comment(_comment_id) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT rsp_number, spl_item_id INTO v_num, v_item FROM public.spl_rsp_items WHERE id = _rsp_item_id;
  IF v_num IS NULL THEN RAISE EXCEPTION 'rsp item not found'; END IF;
  IF _on THEN
    INSERT INTO public.spl_ocs_comment_rsp_links(comment_id, rsp_item_id, scope, mapping_method, confidence)
    VALUES (_comment_id, _rsp_item_id, 'item', 'user', 1)
    ON CONFLICT (comment_id, rsp_item_id) DO NOTHING;
    PERFORM public.spl_ocs_log(v_item, _comment_id, 'spl_ocs_comment_rsp_links', 'insert', 'rsp', NULL, v_num);
  ELSE
    DELETE FROM public.spl_ocs_comment_rsp_links WHERE comment_id = _comment_id AND rsp_item_id = _rsp_item_id;
    PERFORM public.spl_ocs_log(v_item, _comment_id, 'spl_ocs_comment_rsp_links', 'delete', 'rsp', v_num, NULL);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_set_spl_link(_comment_id uuid, _spl_item_id uuid, _on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.spl_ocs_can_manage()
          OR public.rcl_can(auth.uid(), 'SPL', _spl_item_id, 'write')) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  IF _on THEN
    INSERT INTO public.spl_ocs_comment_spl_links(comment_id, spl_item_id, mapping_method, confidence)
    VALUES (_comment_id, _spl_item_id, 'user', 1)
    ON CONFLICT (comment_id, spl_item_id) DO NOTHING;
    PERFORM public.spl_ocs_log(_spl_item_id, _comment_id, 'spl_ocs_comment_spl_links', 'insert', 'spl_link', NULL, 'linked');
  ELSE
    DELETE FROM public.spl_ocs_comment_spl_links WHERE comment_id = _comment_id AND spl_item_id = _spl_item_id;
    PERFORM public.spl_ocs_log(_spl_item_id, _comment_id, 'spl_ocs_comment_spl_links', 'delete', 'spl_link', 'linked', NULL);
  END IF;
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true);
END $function$;

-- =========================================================
-- 8) 편집: RSP
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_rsp_upsert(
  _id uuid, _spl_item_id uuid, _description text, _manufacturer text, _model text,
  _unit text, _qty_required numeric, _qty_available numeric, _qty_short numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_num text; v_seq int; v_spl text; v_item uuid; v_old text;
BEGIN
  IF _id IS NULL THEN
    IF NOT (public.spl_ocs_can_manage()
            OR public.rcl_can(auth.uid(), 'SPL', _spl_item_id, 'write')) THEN
      RAISE EXCEPTION 'permission denied';
    END IF;
    SELECT spl_number INTO v_spl FROM public.spl_items WHERE id = _spl_item_id;
    IF v_spl IS NULL THEN RAISE EXCEPTION 'spl item not found'; END IF;
    -- 기존 번호와 충돌 금지: 항목 내 최대 시퀀스 +1
    SELECT COALESCE(max(NULLIF(regexp_replace(rsp_number, '^.*-RSP-', ''), '')::int), 0) + 1
      INTO v_seq FROM public.spl_rsp_items WHERE spl_item_id = _spl_item_id;
    v_num := v_spl || '-RSP-' || lpad(v_seq::text, 3, '0');
    WHILE EXISTS (SELECT 1 FROM public.spl_rsp_items WHERE rsp_number = v_num) LOOP
      v_seq := v_seq + 1;
      v_num := v_spl || '-RSP-' || lpad(v_seq::text, 3, '0');
    END LOOP;
    INSERT INTO public.spl_rsp_items(spl_item_id, rsp_number, sort_order, description, manufacturer,
      model_or_unique_id, unit, qty_required, qty_available, qty_short, is_active)
    VALUES (_spl_item_id, v_num, v_seq, _description, _manufacturer, _model, _unit,
            _qty_required, _qty_available, _qty_short, true)
    RETURNING id INTO v_id;
    PERFORM public.spl_ocs_log(_spl_item_id, v_id, 'spl_rsp_items', 'insert', 'rsp_number', NULL, v_num);
  ELSE
    SELECT spl_item_id, description INTO v_item, v_old FROM public.spl_rsp_items WHERE id = _id;
    IF v_item IS NULL THEN RAISE EXCEPTION 'rsp item not found'; END IF;
    IF NOT (public.spl_ocs_can_manage()
            OR public.rcl_can(auth.uid(), 'SPL', v_item, 'write')) THEN
      RAISE EXCEPTION 'permission denied';
    END IF;
    UPDATE public.spl_rsp_items
       SET description = _description, manufacturer = _manufacturer, model_or_unique_id = _model,
           unit = _unit, qty_required = _qty_required, qty_available = _qty_available,
           qty_short = _qty_short, updated_at = now()
     WHERE id = _id RETURNING id INTO v_id;
    PERFORM public.spl_ocs_log(v_item, v_id, 'spl_rsp_items', 'update', 'description', v_old, _description);
  END IF;
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'rsp_number', v_num);
END $function$;

CREATE OR REPLACE FUNCTION public.spl_rsp_deactivate(_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item uuid; v_num text;
BEGIN
  SELECT spl_item_id, rsp_number INTO v_item, v_num FROM public.spl_rsp_items WHERE id = _id;
  IF v_item IS NULL THEN RAISE EXCEPTION 'rsp item not found'; END IF;
  IF NOT (public.spl_ocs_can_manage()
          OR public.rcl_can(auth.uid(), 'SPL', v_item, 'write')) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  UPDATE public.spl_rsp_items
     SET is_active = false, inactive_reason = COALESCE(_reason,'user deactivate'),
         inactive_at = now(), updated_at = now()
   WHERE id = _id;
  PERFORM public.spl_ocs_log(v_item, _id, 'spl_rsp_items', 'deactivate', 'is_active', 'true', v_num);
  PERFORM public.spl_ocs_recount_all_internal();
  RETURN jsonb_build_object('ok', true);
END $function$;

-- =========================================================
-- 9) 목록 정본에 캐시 필드 노출 (현재 시점에서만)
-- =========================================================
CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_today boolean := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date)
                     >= (now() AT TIME ZONE 'Asia/Qatar')::date;
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_reqdoc jsonb; v_bands jsonb;
  v_viol_prec int; v_viol_imp int; v_viol_new int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'short_code', short_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'chain_excluded', chain_excluded, 'round_no', round_no, 'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.spl_stage_catalog;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'spl_number', i.spl_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng, 'pic_po', i.pic_po, 'eng_po', i.eng_po,
    'supplier', i.supplier, 'latest_status', i.latest_status,
    'approval_status_raw', i.approval_status_raw, 'revision', i.revision,
    'data_date', i.data_date,
    'active_round', ar.active_round,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'stages', e.stages,
    'na_count', e.na_count, 'done', e.done, 'delayed', e.delayed, 'denom', e.denom,
    'req_doc_done', e.req_doc_done, 'req_doc_total', e.req_doc_total,
    'active_band', e.active_band, 'active_band_state', e.active_band_state,
    'band_states', e.band_states,
    'hdec_actual_count', e.hdec_actual_count, 'has_plan', e.has_plan,
    'completed_stage', e.completed_stage, 'current_stage', e.current_stage,
    'primary_delay', e.primary_delay, 'delay_bucket', e.delay_bucket,
    'progress_pct', CASE WHEN e.denom = 0 THEN NULL
                         ELSE round(e.done::numeric * 100 / e.denom, 1) END,
    'judgment', e.judgment,
    -- 관계 정본에서 파생된 캐시. 과거 as-of 조회에서는 공란(null)
    'ocs_total', CASE WHEN v_today THEN i.ocs_total END,
    'ocs_pending', CASE WHEN v_today THEN i.ocs_pending END,
    'ocs_complied', CASE WHEN v_today THEN i.ocs_complied END,
    'ocs_check', CASE WHEN v_today THEN i.ocs_check END,
    'rsp_total', CASE WHEN v_today THEN i.rsp_total END,
    'document_total', CASE WHEN v_today THEN i.document_total END
  ) ORDER BY i.plot, i.spl_number)
  INTO v_rows
  FROM public.spl_items i
  JOIN public.spl_eval_as_of(v_as_of) e ON e.item_id = i.id
  JOIN public.spl_active_round(v_as_of) ar ON ar.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;
  SELECT jsonb_object_agg(k, n) INTO v_reqdoc FROM (
    SELECT (r->>'req_doc_done') AS k, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;
  SELECT jsonb_object_agg(band, cnt) INTO v_bands FROM (
    SELECT b.key AS band, jsonb_object_agg(b.state, b.n) AS cnt FROM (
      SELECT kv.key, kv.value #>> '{}' AS state, count(*) AS n
      FROM jsonb_array_elements(v_rows) r,
           jsonb_each(r->'band_states') kv
      GROUP BY 1,2) b GROUP BY 1) q2;

  SELECT count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'import_incomplete')
    INTO v_viol_prec, v_viol_imp FROM public.spl_precedence_violations;

  SELECT id INTO v_last_batch FROM public.spl_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_viol_new FROM public.spl_precedence_violations v
   WHERE v_last_batch IS NOT NULL AND v.violation_type = 'precedence'
     AND EXISTS (SELECT 1 FROM public.spl_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'req_doc_counts', coalesce(v_reqdoc, '{}'::jsonb),
    'band_state_counts', coalesce(v_bands, '{}'::jsonb),
    'hdec_missing_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0),
    'hdec_missing_done', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0 AND r->>'judgment' = '완료'),
    'plan_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'has_plan')::boolean),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_prec,0),
      'precedence', coalesce(v_viol_prec,0),
      'import_incomplete', coalesce(v_viol_imp,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch));
END;
$function$;

-- =========================================================
-- 10) 실행 권한: 로그인 사용자만 (PUBLIC/anon 금지)
-- =========================================================
DO $do$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'spl_ocs_can_write_comment(uuid)', 'spl_ocs_log(uuid,uuid,text,text,text,text,text)',
    'spl_ocs_comments_for_spl(uuid)', 'spl_rsp_for_spl(uuid)',
    'spl_ocs_set_complied(uuid,boolean,boolean)', 'spl_ocs_set_category(uuid,uuid,boolean)',
    'spl_ocs_upsert_category(uuid,text,text,boolean)',
    'spl_ocs_upsert_comment(uuid,uuid,text,text,text,text,text,text)',
    'spl_ocs_deactivate_comment(uuid,text)', 'spl_ocs_set_rsp_link(uuid,uuid,boolean)',
    'spl_ocs_set_spl_link(uuid,uuid,boolean)',
    'spl_rsp_upsert(uuid,uuid,text,text,text,text,numeric,numeric,numeric)',
    'spl_rsp_deactivate(uuid,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $do$;