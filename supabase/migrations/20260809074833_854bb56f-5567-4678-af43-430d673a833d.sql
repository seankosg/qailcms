CREATE OR REPLACE FUNCTION public.abd_ocs_inc_dryrun(p_run uuid, p_source_files jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope int; v_existing_active int;
  v_new int; v_update int; v_unchanged int; v_modified int; v_retire int;
  v_att_new int; v_att_exist int; v_att_unres int;
  v_sf_new int; v_sf_rev int; v_sf_exist int;
  v_hash jsonb;
  v_base jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  SELECT count(*) INTO v_scope FROM public.abd_ocs_inc_scope(p_run);

  SELECT count(*) INTO v_existing_active
  FROM public.abd_ocs_comments c
  WHERE c.is_active
    AND COALESCE(c.ocs_number_norm,'') IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s);

  SELECT
    count(*) FILTER (WHERE live.id IS NULL),
    count(*) FILTER (WHERE live.id IS NOT NULL),
    count(*) FILTER (WHERE live.id IS NOT NULL AND NOT changed),
    count(*) FILTER (WHERE live.id IS NOT NULL AND changed)
  INTO v_new, v_update, v_unchanged, v_modified
  FROM (
    SELECT s.source_comment_id, s.ocs_comment, s.assessed_code, s.contractor_response,
           s.comment_part, s.abd_numbers
    FROM public.abd_ocs_v3_stage_comments s WHERE s.stage_run_id = p_run
  ) st
  LEFT JOIN LATERAL (
    SELECT c.id, c.ocs_comment, c.assessed_code, c.contractor_response, c.comment_part
    FROM public.abd_ocs_comments c WHERE c.source_comment_id = st.source_comment_id
  ) live ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(array_agg(l.abd_number ORDER BY l.abd_number), '{}') AS nums
    FROM public.abd_ocs_comment_abd_links l WHERE l.comment_id = live.id
  ) ln ON true
  LEFT JOIN LATERAL (
    SELECT (
      COALESCE(live.ocs_comment,'') IS DISTINCT FROM COALESCE(st.ocs_comment,'')
      OR COALESCE(live.assessed_code,'') IS DISTINCT FROM COALESCE(st.assessed_code,'')
      OR COALESCE(live.contractor_response,'') IS DISTINCT FROM COALESCE(st.contractor_response,'')
      -- 정본 타입(text) 기준 명시 비교: staging 은 integer 이므로 ::text 로 캐스팅한다.
      OR COALESCE(live.comment_part::text,'') IS DISTINCT FROM COALESCE(st.comment_part::text,'')
      OR (SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(COALESCE(st.abd_numbers,'{}')) x)
         IS DISTINCT FROM ln.nums
    ) AS changed
  ) ch ON true;

  SELECT count(*) INTO v_retire
  FROM public.abd_ocs_comments c
  WHERE c.is_active
    AND COALESCE(c.ocs_number_norm,'') IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s)
    AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s2
                     WHERE s2.stage_run_id = p_run AND s2.source_comment_id = c.source_comment_id)
    AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s3
                     WHERE s3.stage_run_id = p_run AND s3.source_parent_comment_id = c.source_comment_id);

  SELECT
    count(*) FILTER (WHERE a.id IS NULL),
    count(*) FILTER (WHERE a.id IS NOT NULL),
    count(*) FILTER (WHERE sa.atomic_comment_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_comments c2
                                        WHERE c2.source_comment_id = sa.atomic_comment_id)
                       AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s4
                                        WHERE s4.stage_run_id = p_run AND s4.source_comment_id = sa.atomic_comment_id))
  INTO v_att_new, v_att_exist, v_att_unres
  FROM public.abd_ocs_v3_stage_attachments sa
  LEFT JOIN public.abd_ocs_attachments a ON a.source_attachment_id = sa.attachment_id
  WHERE sa.stage_run_id = p_run;

  SELECT
    count(*) FILTER (WHERE f.id IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.abd_ocs_source_files f2 WHERE f2.file_name = x->>'file_name')),
    count(*) FILTER (WHERE f.id IS NULL AND EXISTS (
      SELECT 1 FROM public.abd_ocs_source_files f3 WHERE f3.file_name = x->>'file_name')),
    count(*) FILTER (WHERE f.id IS NOT NULL)
  INTO v_sf_new, v_sf_rev, v_sf_exist
  FROM jsonb_array_elements(COALESCE(p_source_files, '[]'::jsonb)) x
  LEFT JOIN public.abd_ocs_source_files f ON f.content_hash = x->>'content_hash';

  IF v_update <> v_unchanged + v_modified THEN
    RAISE EXCEPTION 'dryrun identity violated: comments_to_update % <> unchanged % + modified %',
      v_update, v_unchanged, v_modified;
  END IF;

  v_hash := public.abd_ocs_inc_outside_hash(p_run);
  v_base := public.abd_ocs_inc_baseline(NULL);

  RETURN jsonb_build_object(
    'stage_run_id', p_run,
    'scope_ocs_count', v_scope,
    'scope_existing_active', v_existing_active,
    'comments_new', v_new,
    'comments_to_update', v_update,
    'comments_unchanged', v_unchanged,
    'comments_modified', v_modified,
    'comments_to_retire', v_retire,
    'attachments_new', v_att_new,
    'attachments_existing', v_att_exist,
    'attachments_unresolved', v_att_unres,
    'source_files_new', v_sf_new,
    'source_files_revised', v_sf_rev,
    'source_files_existing', v_sf_exist,
    'outside_scope_comment_hash_before', v_hash->>'comments',
    'outside_scope_link_hash_before', v_hash->>'links',
    'mass_retire_threshold_pct', 0.30,
    'mass_retire_threshold_abs', 100,
    'mass_retire_blocked', (v_retire > v_existing_active * 0.30 OR v_retire > 100),
    'baseline', v_base,
    'v3', public.abd_ocs_v3_dryrun(p_run)
  );
END
$function$;