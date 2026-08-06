-- OCS Baseline: core hash + whitelist dump (read-only, admin only)

CREATE OR REPLACE FUNCTION public.abd_ocs_baseline_core_hash()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb := '{}'::jsonb;
  v_concat text := '';
  t text;
  h text;
  core text[] := ARRAY[
    'abd_ocs_comments',
    'abd_ocs_comment_groups',
    'abd_ocs_comment_abd_links',
    'abd_ocs_attachments',
    'abd_ocs_attachment_comment_links',
    'abd_ocs_response_segments',
    'abd_ocs_response_comment_links',
    'abd_ocs_source_files'
  ];
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  FOREACH t IN ARRAY core LOOP
    CASE t
      WHEN 'abd_ocs_comments' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_comments c
              ORDER BY c.source_comment_id, c.id) s;
      WHEN 'abd_ocs_comment_groups' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_comment_groups c
              ORDER BY c.group_key, c.id) s;
      WHEN 'abd_ocs_comment_abd_links' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_comment_abd_links c
              ORDER BY c.source_comment_id, c.abd_number, c.id) s;
      WHEN 'abd_ocs_attachments' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_attachments c
              ORDER BY c.source_attachment_id, c.id) s;
      WHEN 'abd_ocs_attachment_comment_links' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_attachment_comment_links c
              ORDER BY c.source_attachment_id, c.source_comment_id, c.id) s;
      WHEN 'abd_ocs_response_segments' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_response_segments c
              ORDER BY c.source_parent_comment_id, c.response_segment_no, c.id) s;
      WHEN 'abd_ocs_response_comment_links' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_response_comment_links c
              ORDER BY c.source_atomic_comment_id, c.response_segment_id, c.id) s;
      WHEN 'abd_ocs_source_files' THEN
        SELECT encode(extensions.digest(COALESCE(string_agg(x, E'\n'), ''), 'sha256'), 'hex') INTO h
        FROM (SELECT to_jsonb(c)::text x FROM public.abd_ocs_source_files c
              ORDER BY c.source_file_id, c.id) s;
    END CASE;
    v := v || jsonb_build_object(t, h);
    v_concat := v_concat || t || ':' || h || E'\n';
  END LOOP;

  RETURN jsonb_build_object(
    'schema_version', 'ocs-baseline-v1',
    'core_tables', to_jsonb(core),
    'core_table_hashes', v,
    'core_hash', encode(extensions.digest(v_concat, 'sha256'), 'hex'),
    'core_last_changed_at', (
      SELECT max(t2) FROM (
        SELECT max(updated_at) t2 FROM public.abd_ocs_comments
        UNION ALL SELECT max(updated_at) FROM public.abd_ocs_comment_groups
        UNION ALL SELECT max(updated_at) FROM public.abd_ocs_comment_abd_links
        UNION ALL SELECT max(created_at) FROM public.abd_ocs_attachments
        UNION ALL SELECT max(updated_at) FROM public.abd_ocs_attachment_comment_links
        UNION ALL SELECT max(updated_at) FROM public.abd_ocs_response_segments
        UNION ALL SELECT max(updated_at) FROM public.abd_ocs_response_comment_links
        UNION ALL SELECT max(created_at) FROM public.abd_ocs_source_files
      ) q
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_baseline_dump(
  p_dataset text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb;
  v_total bigint;
  v_off integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 4000);
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  CASE p_dataset
    WHEN 'comments' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_comments;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_comments c
        ORDER BY c.source_comment_id, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'comment_groups' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_comment_groups;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_comment_groups c
        ORDER BY c.group_key, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'comment_abd_links' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_comment_abd_links;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_comment_abd_links c
        ORDER BY c.source_comment_id, c.abd_number, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'attachments' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_attachments;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_attachments c
        ORDER BY c.source_attachment_id, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'attachment_comment_links' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_attachment_comment_links;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_attachment_comment_links c
        ORDER BY c.source_attachment_id, c.source_comment_id, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'response_segments' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_response_segments;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_response_segments c
        ORDER BY c.source_parent_comment_id, c.response_segment_no, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'response_comment_links' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_response_comment_links;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_response_comment_links c
        ORDER BY c.source_atomic_comment_id, c.response_segment_id, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'compliance' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_compliance;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_compliance c
        ORDER BY c.comment_id OFFSET v_off LIMIT v_lim) s;
    WHEN 'source_files' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_source_files;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_source_files c
        ORDER BY c.source_file_id, c.id OFFSET v_off LIMIT v_lim) s;
    WHEN 'number_corrections' THEN
      SELECT count(*) INTO v_total FROM public.abd_ocs_number_correction_log;
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
        SELECT to_jsonb(c) x FROM public.abd_ocs_number_correction_log c
        ORDER BY c.id OFFSET v_off LIMIT v_lim) s;
    ELSE
      RAISE EXCEPTION 'abd_ocs_baseline_dump: unknown dataset %', p_dataset;
  END CASE;

  RETURN jsonb_build_object(
    'dataset', p_dataset,
    'offset', v_off,
    'limit', v_lim,
    'row_count', v_total,
    'returned', jsonb_array_length(v_rows),
    'rows', v_rows
  );
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_baseline_core_hash() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abd_ocs_baseline_dump(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_baseline_core_hash() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abd_ocs_baseline_dump(text, integer, integer) TO authenticated, service_role;