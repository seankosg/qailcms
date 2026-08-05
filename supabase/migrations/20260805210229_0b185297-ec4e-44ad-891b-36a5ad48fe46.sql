-- ─────────────────────────────────────────────────────────────
-- Stage 4: 공통 Scope (dry-run 과 import 가 반드시 함께 사용)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_scope(p_run uuid)
RETURNS TABLE(ocs_norm text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT public.abd_ocs_norm(COALESCE(g.v3_ocs_number, g.ocs_number))
  FROM public.abd_ocs_v3_stage_groups g
  WHERE g.stage_run_id = p_run
    AND COALESCE(g.v3_ocs_number, g.ocs_number) IS NOT NULL
$function$;

-- ─────────────────────────────────────────────────────────────
-- Stage 5: 범위 밖 보호 해시 (comments / comment-ABD links)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_outside_hash(p_run uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'comments', (
      SELECT md5(COALESCE(string_agg(
        c.source_comment_id || ':' || c.is_active::text || ':' || coalesce(c.retired_reason,''),
        ',' ORDER BY c.source_comment_id), ''))
      FROM public.abd_ocs_comments c
      WHERE COALESCE(c.ocs_number_norm,'') NOT IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s)
    ),
    'links', (
      SELECT md5(COALESCE(string_agg(
        l.source_comment_id || ':' || l.abd_number || ':' || l.is_primary::text,
        ',' ORDER BY l.source_comment_id, l.abd_number), ''))
      FROM public.abd_ocs_comment_abd_links l
      JOIN public.abd_ocs_comments c ON c.id = l.comment_id
      WHERE COALESCE(c.ocs_number_norm,'') NOT IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s)
    )
  )
$function$;

-- ─────────────────────────────────────────────────────────────
-- Stage 4: 증분 Dry-run (읽기 전용)
--   변경 판정 5축: ocs_comment / assessed_code / contractor_response / comment_part / abd_numbers
-- ─────────────────────────────────────────────────────────────
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
      OR live.comment_part IS DISTINCT FROM st.comment_part
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

-- ─────────────────────────────────────────────────────────────
-- Stage 9: Baseline 최신성 정보 (Compliance 변경은 차단 사유 아님)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_baseline(p_base_import_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_latest uuid; v_latest_at timestamptz; v_base_at timestamptz; v_core timestamptz;
BEGIN
  SELECT l.id, COALESCE(l.finished_at, l.started_at)
    INTO v_latest, v_latest_at
  FROM public.abd_ocs_import_logs l
  WHERE l.status = 'success'
  ORDER BY COALESCE(l.finished_at, l.started_at) DESC
  LIMIT 1;

  IF p_base_import_run_id IS NOT NULL THEN
    SELECT COALESCE(l.finished_at, l.started_at) INTO v_base_at
    FROM public.abd_ocs_import_logs l WHERE l.id = p_base_import_run_id;
  END IF;

  SELECT max(t) INTO v_core FROM (
    SELECT max(updated_at) t FROM public.abd_ocs_comments
    UNION ALL SELECT max(updated_at) FROM public.abd_ocs_comment_groups
    UNION ALL SELECT max(updated_at) FROM public.abd_ocs_comment_abd_links
    UNION ALL SELECT max(created_at) FROM public.abd_ocs_attachments
    UNION ALL SELECT max(updated_at) FROM public.abd_ocs_attachment_comment_links
    UNION ALL SELECT max(updated_at) FROM public.abd_ocs_response_segments
    UNION ALL SELECT max(updated_at) FROM public.abd_ocs_response_comment_links
    UNION ALL SELECT max(created_at) FROM public.abd_ocs_source_files
  ) q;

  RETURN jsonb_build_object(
    'latest_success_import_run_id', v_latest,
    'latest_success_at', v_latest_at,
    'base_import_run_id', p_base_import_run_id,
    'base_import_run_found', v_base_at IS NOT NULL,
    'base_import_run_at', v_base_at,
    'core_last_changed_at', v_core,
    'core_changed_since_base', (v_base_at IS NOT NULL AND v_core IS NOT NULL AND v_core > v_base_at),
    'is_latest', (p_base_import_run_id IS NOT NULL AND p_base_import_run_id = v_latest)
  );
END
$function$;

-- ─────────────────────────────────────────────────────────────
-- Stage 5·6·8: 증분 Import 본체
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_import(
  p_run uuid,
  p_import_log_id uuid,
  p_allow_retire boolean DEFAULT false,
  p_source_files jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dry jsonb; v_before jsonb; v_after jsonb;
  v_retire int; v_existing_active int; v_v3 jsonb; v_retired int := 0; v_logs int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  v_dry := public.abd_ocs_inc_dryrun(p_run, p_source_files);
  v_retire := (v_dry->>'comments_to_retire')::int;
  v_existing_active := (v_dry->>'scope_existing_active')::int;

  -- Stage 8: 대량 퇴역 보호 (30% 또는 100건)
  IF (v_retire > v_existing_active * 0.30 OR v_retire > 100) AND NOT p_allow_retire THEN
    RAISE EXCEPTION 'mass retire blocked: % of % active in scope (limits 30%% / 100). Allow retire required.',
      v_retire, v_existing_active;
  END IF;

  v_before := public.abd_ocs_inc_outside_hash(p_run);

  -- 변경 전 값 스냅샷 (필드 로그용)
  CREATE TEMP TABLE IF NOT EXISTS _inc_prev(
    source_comment_id text PRIMARY KEY,
    ocs_comment text, assessed_code text, contractor_response text,
    is_active boolean, retired_reason text
  ) ON COMMIT DROP;
  DELETE FROM _inc_prev;
  INSERT INTO _inc_prev
  SELECT c.source_comment_id, c.ocs_comment, c.assessed_code, c.contractor_response,
         c.is_active, c.retired_reason
  FROM public.abd_ocs_comments c
  WHERE c.source_comment_id IN (SELECT s.source_comment_id FROM public.abd_ocs_v3_stage_comments s WHERE s.stage_run_id = p_run)
     OR COALESCE(c.ocs_number_norm,'') IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s);

  -- 정본 반영은 기존 V3 배관 재사용
  v_v3 := public.abd_ocs_v3_import(p_run, p_import_log_id);

  -- Stage 5: 범위 안에서만 퇴역 (물리 삭제 금지)
  WITH ret AS (
    UPDATE public.abd_ocs_comments c
       SET is_active = false,
           inactive_at = COALESCE(c.inactive_at, now()),
           retired_reason = 'absent_in_revision',
           updated_at = now()
     WHERE c.is_active
       AND COALESCE(c.ocs_number_norm,'') IN (SELECT COALESCE(s.ocs_norm,'') FROM public.abd_ocs_inc_scope(p_run) s)
       AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s2
                        WHERE s2.stage_run_id = p_run AND s2.source_comment_id = c.source_comment_id)
       AND NOT EXISTS (SELECT 1 FROM public.abd_ocs_v3_stage_comments s3
                        WHERE s3.stage_run_id = p_run AND s3.source_parent_comment_id = c.source_comment_id)
    RETURNING 1
  ) SELECT count(*) INTO v_retired FROM ret;

  -- Stage 6: 기존 import_field_logs 배관에 5개 필드 변경만 기록
  WITH cur AS (
    SELECT c.source_comment_id, c.ocs_comment, c.assessed_code, c.contractor_response,
           c.is_active, c.retired_reason
    FROM public.abd_ocs_comments c
    WHERE c.source_comment_id IN (SELECT source_comment_id FROM _inc_prev)
  ), diff AS (
    SELECT p.source_comment_id, f.field_name, f.prev, f.next
    FROM _inc_prev p JOIN cur c USING (source_comment_id)
    CROSS JOIN LATERAL (VALUES
      ('ocs_comment', p.ocs_comment, c.ocs_comment),
      ('assessed_code', p.assessed_code, c.assessed_code),
      ('contractor_response', p.contractor_response, c.contractor_response),
      ('is_active', p.is_active::text, c.is_active::text),
      ('retired_reason', p.retired_reason, c.retired_reason)
    ) AS f(field_name, prev, next)
    WHERE COALESCE(f.prev,'') IS DISTINCT FROM COALESCE(f.next,'')
  ), ins AS (
    INSERT INTO public.import_field_logs
      (upload_id, kind, raw_row_no, field_name, outcome, raw_value, applied_value, previous_value, reason_code, reason_detail, created_by)
    SELECT p_import_log_id, 'abd', NULL, d.field_name, 'applied', d.next, d.next, d.prev,
           'ocs_increment', d.source_comment_id, auth.uid()
    FROM diff d
    RETURNING 1
  ) SELECT count(*) INTO v_logs FROM ins;

  -- 신규 코멘트도 기록 (이전 값 없음)
  INSERT INTO public.import_field_logs
    (upload_id, kind, raw_row_no, field_name, outcome, raw_value, applied_value, previous_value, reason_code, reason_detail, created_by)
  SELECT p_import_log_id, 'abd', NULL, 'ocs_comment', 'applied', c.ocs_comment, c.ocs_comment, NULL,
         'ocs_increment_new', c.source_comment_id, auth.uid()
  FROM public.abd_ocs_comments c
  JOIN public.abd_ocs_v3_stage_comments s
    ON s.stage_run_id = p_run AND s.source_comment_id = c.source_comment_id
  WHERE NOT EXISTS (SELECT 1 FROM _inc_prev p WHERE p.source_comment_id = c.source_comment_id);

  -- Stage 5: 범위 밖 보호 재검증 — 한 칸이라도 달라지면 전체 롤백
  v_after := public.abd_ocs_inc_outside_hash(p_run);
  IF (v_before->>'comments') IS DISTINCT FROM (v_after->>'comments') THEN
    RAISE EXCEPTION 'outside-scope comments changed (before % / after %)', v_before->>'comments', v_after->>'comments';
  END IF;
  IF (v_before->>'links') IS DISTINCT FROM (v_after->>'links') THEN
    RAISE EXCEPTION 'outside-scope comment-ABD links changed (before % / after %)', v_before->>'links', v_after->>'links';
  END IF;

  PERFORM public.abd_ocs_recount_all();

  RETURN jsonb_build_object(
    'stage_run_id', p_run,
    'import_log_id', p_import_log_id,
    'dryrun', v_dry,
    'v3', v_v3,
    'retired_in_scope', v_retired,
    'field_logs', v_logs,
    'outside_scope_comment_hash_before', v_before->>'comments',
    'outside_scope_comment_hash_after', v_after->>'comments',
    'outside_scope_link_hash_before', v_before->>'links',
    'outside_scope_link_hash_after', v_after->>'links'
  );
END
$function$;