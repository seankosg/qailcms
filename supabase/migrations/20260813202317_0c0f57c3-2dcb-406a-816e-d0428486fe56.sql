-- digest() 는 pgcrypto(extensions 스키마)에 있어 search_path=public 에서 해석되지 않는다.
-- 내장 sha256(bytea) 로 교체한다.
CREATE OR REPLACE FUNCTION public.abd_ocs_pd_tok(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN v IS NULL OR v = '' THEN '~'
    ELSE ':' || replace(replace(replace(v, '\', '\\'), chr(31), '\x1f'), chr(10), '\n')
  END
$$;

CREATE OR REPLACE FUNCTION public.abd_ocs_pd_tok_arr(v text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ':' || COALESCE((
    SELECT string_agg(replace(replace(replace(x, '\', '\\'), chr(31), '\x1f'), chr(10), '\n'), chr(30)
                      ORDER BY ord)
    FROM unnest(COALESCE(v, '{}'::text[])) WITH ORDINALITY AS t(x, ord)
  ), '')
$$;

CREATE OR REPLACE FUNCTION public.abd_ocs_inc_stage_payload_digest(p_run uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_us   text := chr(31);
  v_txt  text := 'ocs-payload-digest/1' || chr(10);
  v_sec  text;
  v_g int; v_c int; v_a int; v_r int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  WITH l AS (
    SELECT concat_ws(v_us,
      abd_ocs_pd_tok(group_id), abd_ocs_pd_tok(source_parent_comment_id),
      abd_ocs_pd_tok(ocs_number), abd_ocs_pd_tok(drawing_number),
      abd_ocs_pd_tok(source_file_name), abd_ocs_pd_tok(source_sheet),
      abd_ocs_pd_tok(source_row::text), abd_ocs_pd_tok(item_count::text),
      abd_ocs_pd_tok(split_status), abd_ocs_pd_tok(group_contractor_response),
      abd_ocs_pd_tok(v3_ocs_number)) AS line
    FROM public.abd_ocs_v3_stage_groups WHERE stage_run_id = p_run
  )
  SELECT COALESCE(string_agg(line, chr(10) ORDER BY encode(convert_to(line, 'UTF8'), 'hex')), ''),
         count(*) INTO v_sec, v_g FROM l;
  v_txt := v_txt || '#groups' || chr(9) || v_g || chr(10) || v_sec || chr(10);

  WITH l AS (
    SELECT concat_ws(v_us,
      abd_ocs_pd_tok(source_comment_id), abd_ocs_pd_tok(source_parent_comment_id),
      abd_ocs_pd_tok(comment_group_id), abd_ocs_pd_tok(atomic_item_no::text),
      abd_ocs_pd_tok(atomic_item_count::text), abd_ocs_pd_tok(split_status),
      abd_ocs_pd_tok(comment_part::text), abd_ocs_pd_tok(ocs_comment),
      abd_ocs_pd_tok(assessed_code), abd_ocs_pd_tok(contractor_response),
      abd_ocs_pd_tok(ocs_number), abd_ocs_pd_tok(drawing_number),
      abd_ocs_pd_tok(source_file_name), abd_ocs_pd_tok(source_sheet_name),
      abd_ocs_pd_tok(source_row_index::text), abd_ocs_pd_tok_arr(abd_numbers),
      abd_ocs_pd_tok(link_status), abd_ocs_pd_tok(link_scope), abd_ocs_pd_tok(link_method),
      abd_ocs_pd_tok(CASE WHEN is_active THEN 'true' ELSE 'false' END),
      abd_ocs_pd_tok(retired_reason),
      abd_ocs_pd_tok(CASE WHEN initial_complied THEN 'true' ELSE 'false' END),
      abd_ocs_pd_tok(compliance_source), abd_ocs_pd_tok(compliance_reason)) AS line
    FROM public.abd_ocs_v3_stage_comments WHERE stage_run_id = p_run
  )
  SELECT COALESCE(string_agg(line, chr(10) ORDER BY encode(convert_to(line, 'UTF8'), 'hex')), ''),
         count(*) INTO v_sec, v_c FROM l;
  v_txt := v_txt || '#comments' || chr(9) || v_c || chr(10) || v_sec || chr(10);

  WITH l AS (
    SELECT concat_ws(v_us,
      abd_ocs_pd_tok(attachment_id), abd_ocs_pd_tok(comment_id),
      abd_ocs_pd_tok(source_parent_comment_id), abd_ocs_pd_tok(comment_group_id),
      abd_ocs_pd_tok(atomic_comment_id), abd_ocs_pd_tok(attachment_scope),
      abd_ocs_pd_tok(storage_path), abd_ocs_pd_tok(lower(content_hash)),
      abd_ocs_pd_tok(byte_size::text), abd_ocs_pd_tok(width::text),
      abd_ocs_pd_tok(height::text), abd_ocs_pd_tok(image_format),
      abd_ocs_pd_tok(mime_type), abd_ocs_pd_tok(source_image_index::text)) AS line
    FROM public.abd_ocs_v3_stage_attachments WHERE stage_run_id = p_run
  )
  SELECT COALESCE(string_agg(line, chr(10) ORDER BY encode(convert_to(line, 'UTF8'), 'hex')), ''),
         count(*) INTO v_sec, v_a FROM l;
  v_txt := v_txt || '#attachments' || chr(9) || v_a || chr(10) || v_sec || chr(10);

  WITH l AS (
    SELECT concat_ws(v_us,
      abd_ocs_pd_tok(group_id), abd_ocs_pd_tok(source_parent_comment_id),
      abd_ocs_pd_tok(response_segment_no::text), abd_ocs_pd_tok(response_source_label),
      abd_ocs_pd_tok(response_text), abd_ocs_pd_tok(atomic_comment_id),
      abd_ocs_pd_tok(mapping_status), abd_ocs_pd_tok(mapping_method),
      abd_ocs_pd_tok(source_file_name), abd_ocs_pd_tok(source_sheet),
      abd_ocs_pd_tok(source_row::text),
      abd_ocs_pd_tok(CASE WHEN generic_response THEN 'true' ELSE 'false' END)) AS line
    FROM public.abd_ocs_v3_stage_response WHERE stage_run_id = p_run
  )
  SELECT COALESCE(string_agg(line, chr(10) ORDER BY encode(convert_to(line, 'UTF8'), 'hex')), ''),
         count(*) INTO v_sec, v_r FROM l;
  v_txt := v_txt || '#responses' || chr(9) || v_r || chr(10) || v_sec || chr(10);

  RETURN jsonb_build_object(
    'digest_version', 'ocs-payload-digest/1',
    'payload_sha256', encode(sha256(convert_to(v_txt, 'UTF8')), 'hex'),
    'groups', v_g,
    'comments', v_c,
    'attachments', v_a,
    'responses', v_r,
    'corrections', 0
  );
END $function$;

REVOKE ALL ON FUNCTION public.abd_ocs_inc_stage_payload_digest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abd_ocs_inc_stage_payload_digest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_inc_stage_payload_digest(uuid) TO service_role;