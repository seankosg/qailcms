-- 1) last-change attribution 분리
ALTER TABLE public.abd_ocs_compliance
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_name text;

-- 2) 관리자 직접 INSERT/UPDATE 정책 제거 (RPC 경유 강제)
DROP POLICY IF EXISTS abd_ocs_compliance_admin_insert ON public.abd_ocs_compliance;
DROP POLICY IF EXISTS abd_ocs_compliance_admin_update ON public.abd_ocs_compliance;

-- 3) 조회 RPC
CREATE OR REPLACE FUNCTION public.abd_ocs_comments_for_item(p_abd_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  ), a AS (
    SELECT at.comment_id,
           jsonb_agg(jsonb_build_object(
             'id', at.id,
             'source_attachment_id', at.source_attachment_id,
             'storage_path', at.storage_path,
             'mime_type', at.mime_type,
             'width', at.width,
             'height', at.height,
             'sort_order', at.sort_order
           ) ORDER BY at.sort_order, at.source_attachment_id) AS atts
    FROM public.abd_ocs_attachments at
    WHERE at.comment_id IN (SELECT id FROM c)
    GROUP BY at.comment_id
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
           'complied', c.complied,
           'compliance_source', c.compliance_source,
           'complied_by_name', c.complied_by_name,
           'complied_at', c.complied_at,
           'attachments', COALESCE(a.atts, '[]'::jsonb)
         ) ORDER BY c.ocs_number NULLS LAST, c.source_row_index NULLS LAST, c.comment_part NULLS LAST, c.source_comment_id), '[]'::jsonb),
         COUNT(*)::int,
         COUNT(*) FILTER (WHERE c.complied)::int
    INTO v_rows, v_total, v_complied
  FROM c LEFT JOIN a ON a.comment_id = c.id;

  RETURN jsonb_build_object(
    'abd_item_id', p_abd_item_id,
    'total', v_total,
    'complied', v_complied,
    'pending', v_total - v_complied,
    'can_write', v_can_write,
    'comments', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.abd_ocs_comments_for_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_comments_for_item(uuid) TO authenticated;

-- 4) Complied mutation RPC
CREATE OR REPLACE FUNCTION public.abd_ocs_set_complied(
  p_comment_id uuid,
  p_expected boolean,
  p_complied boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_item uuid;
  v_abd_number text;
  v_ocs_number text;
  v_src_cid text;
  v_active boolean;
  v_link text;
  v_current boolean;
  v_total int;
  v_complied int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OCS_UNAUTHENTICATED';
  END IF;

  SELECT co.abd_item_id, co.is_active, co.link_status, co.ocs_number, co.source_comment_id
    INTO v_item, v_active, v_link, v_ocs_number, v_src_cid
  FROM public.abd_ocs_comments co
  WHERE co.id = p_comment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OCS_COMMENT_NOT_FOUND';
  END IF;
  IF NOT v_active OR v_link <> 'linked' OR v_item IS NULL THEN
    RAISE EXCEPTION 'OCS_COMMENT_NOT_EDITABLE';
  END IF;

  SELECT ai.abd_number INTO v_abd_number FROM public.abd_items_raw ai WHERE ai.id = v_item;
  IF v_abd_number IS NULL THEN
    RAISE EXCEPTION 'OCS_ABD_ITEM_NOT_FOUND';
  END IF;

  IF NOT public.rcl_can(v_uid, 'ABD', v_item, 'write') THEN
    RAISE EXCEPTION 'OCS_FORBIDDEN_WRITE';
  END IF;

  SELECT COALESCE(cp.complied, false) INTO v_current
  FROM public.abd_ocs_compliance cp WHERE cp.comment_id = p_comment_id;
  v_current := COALESCE(v_current, false);

  IF v_current <> p_expected THEN
    RAISE EXCEPTION 'OCS_COMPLIANCE_STALE';
  END IF;

  SELECT p.name INTO v_name FROM public.profiles p WHERE p.id = v_uid;

  IF v_current <> p_complied THEN
    INSERT INTO public.abd_ocs_compliance AS t
      (comment_id, complied, source, complied_by, complied_by_name, complied_at, updated_by, updated_by_name, updated_at)
    VALUES
      (p_comment_id, p_complied, 'user',
       CASE WHEN p_complied THEN v_uid ELSE NULL END,
       CASE WHEN p_complied THEN v_name ELSE NULL END,
       CASE WHEN p_complied THEN now() ELSE NULL END,
       v_uid, v_name, now())
    ON CONFLICT (comment_id) DO UPDATE SET
      complied = EXCLUDED.complied,
      source = 'user',
      complied_by = CASE WHEN EXCLUDED.complied THEN v_uid ELSE NULL END,
      complied_by_name = CASE WHEN EXCLUDED.complied THEN v_name ELSE NULL END,
      complied_at = CASE WHEN EXCLUDED.complied THEN now() ELSE NULL END,
      updated_by = v_uid,
      updated_by_name = v_name,
      updated_at = now();

    INSERT INTO public.abd_ocs_compliance_log
      (comment_id, abd_item_id, source_comment_id, abd_number, ocs_number,
       old_complied, new_complied, source, changed_by, changed_by_name, changed_at)
    VALUES
      (p_comment_id, v_item, v_src_cid, v_abd_number, v_ocs_number,
       v_current, p_complied, 'user', v_uid, v_name, now());
  END IF;

  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE COALESCE(cp.complied, false))::int
    INTO v_total, v_complied
  FROM public.abd_ocs_comments co
  LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = co.id
  WHERE co.abd_item_id = v_item AND co.is_active = true AND co.link_status = 'linked';

  RETURN jsonb_build_object(
    'comment_id', p_comment_id,
    'abd_item_id', v_item,
    'complied', p_complied,
    'changed', (v_current <> p_complied),
    'complied_by_name', CASE WHEN p_complied THEN v_name ELSE NULL END,
    'complied_at', CASE WHEN p_complied THEN now() ELSE NULL END,
    'total', v_total,
    'complied_count', v_complied,
    'pending', v_total - v_complied
  );
END;
$$;

REVOKE ALL ON FUNCTION public.abd_ocs_set_complied(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_set_complied(uuid, boolean, boolean) TO authenticated;