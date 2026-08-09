CREATE OR REPLACE FUNCTION public.abd_ocs_inc_register_images(p_run uuid, p_image_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bad text; v_ins int := 0; v_reuse int := 0; v_total int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  IF jsonb_typeof(COALESCE(p_image_meta,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_image_meta must be a json array';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _inc_img(
    source_attachment_id text PRIMARY KEY,
    storage_path text NOT NULL,
    content_hash text NOT NULL,
    byte_size bigint NOT NULL,
    width int, height int, image_format text, mime_type text,
    source_image_index int,
    source_parent_comment_id text,
    atomic_comment_id text,
    attachment_scope text
  ) ON COMMIT DROP;
  DELETE FROM _inc_img WHERE source_attachment_id IS NOT NULL;

  -- 계약 검증
  SELECT string_agg(COALESCE(e->>'source_attachment_id','(no id)'), ', ')
    INTO v_bad
  FROM jsonb_array_elements(COALESCE(p_image_meta,'[]'::jsonb)) e
  WHERE NULLIF(e->>'source_attachment_id','') IS NULL
     OR NULLIF(e->>'storage_path','') IS NULL
     OR NULLIF(e->>'content_hash','') IS NULL
     OR NULLIF(e->>'byte_size','') IS NULL
     OR NULLIF(e->>'attachment_scope','') IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'IMAGE_METADATA_MISSING: %', v_bad;
  END IF;

  INSERT INTO _inc_img
  SELECT e->>'source_attachment_id', e->>'storage_path', lower(e->>'content_hash'),
         (e->>'byte_size')::bigint,
         NULLIF(e->>'width','')::int, NULLIF(e->>'height','')::int,
         NULLIF(e->>'image_format',''), NULLIF(e->>'mime_type',''),
         NULLIF(e->>'source_image_index','')::int,
         NULLIF(e->>'source_parent_comment_id',''),
         NULLIF(e->>'atomic_comment_id',''),
         e->>'attachment_scope'
  FROM jsonb_array_elements(COALESCE(p_image_meta,'[]'::jsonb)) e
  ON CONFLICT (source_attachment_id) DO NOTHING;

  SELECT count(*) INTO v_total FROM _inc_img;

  -- 패키지 내부 중복 path
  SELECT string_agg(storage_path, ', ') INTO v_bad
  FROM (SELECT storage_path FROM _inc_img GROUP BY storage_path HAVING count(*) > 1) q;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'IMAGE_DUPLICATE_PATH_IN_PACKAGE: %', v_bad;
  END IF;

  -- 같은 ID, 다른 path/hash
  SELECT string_agg(format('%s (db %s/%s <> pkg %s/%s)', m.source_attachment_id,
           a.storage_path, left(COALESCE(a.content_hash,'(null)'),12),
           m.storage_path, left(m.content_hash,12)), ', ')
    INTO v_bad
  FROM _inc_img m
  JOIN public.abd_ocs_attachments a ON a.source_attachment_id = m.source_attachment_id
  WHERE a.content_hash IS NULL
     OR a.storage_path IS DISTINCT FROM m.storage_path
     OR lower(a.content_hash) IS DISTINCT FROM m.content_hash;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'IMAGE_ID_CONFLICT: %', v_bad;
  END IF;

  -- 같은 path, 다른 ID/hash
  SELECT string_agg(format('%s (db id %s <> pkg id %s)', m.storage_path,
           a.source_attachment_id, m.source_attachment_id), ', ')
    INTO v_bad
  FROM _inc_img m
  JOIN public.abd_ocs_attachments a ON a.storage_path = m.storage_path
  WHERE a.content_hash IS NULL
     OR a.source_attachment_id IS DISTINCT FROM m.source_attachment_id
     OR lower(a.content_hash) IS DISTINCT FROM m.content_hash;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'IMAGE_PATH_CONFLICT: %', v_bad;
  END IF;

  SELECT count(*) INTO v_reuse
  FROM _inc_img m JOIN public.abd_ocs_attachments a
    ON a.source_attachment_id = m.source_attachment_id;

  -- 신규만 INSERT. comment_id 는 single scope 의 확정 atomic comment 에만 설정.
  WITH ins AS (
    INSERT INTO public.abd_ocs_attachments
      (source_attachment_id, storage_path, content_hash, byte_size, width, height,
       image_format, mime_type, source_image_index, source_comment_id, comment_id, link_status)
    SELECT m.source_attachment_id, m.storage_path, m.content_hash, m.byte_size, m.width, m.height,
           m.image_format, m.mime_type, m.source_image_index,
           COALESCE(m.atomic_comment_id, m.source_parent_comment_id),
           CASE WHEN m.attachment_scope = 'single' AND m.atomic_comment_id IS NOT NULL
                THEN (SELECT c.id FROM public.abd_ocs_comments c
                       WHERE c.source_comment_id = m.atomic_comment_id) END,
           'unmatched'
    FROM _inc_img m
    WHERE NOT EXISTS (SELECT 1 FROM public.abd_ocs_attachments a
                       WHERE a.source_attachment_id = m.source_attachment_id)
    RETURNING 1
  ) SELECT count(*) INTO v_ins FROM ins;

  RETURN jsonb_build_object(
    'images_declared', v_total,
    'images_inserted', v_ins,
    'images_reused', v_reuse
  );
END $function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_inc_import_core(p_run uuid, p_import_log_id uuid, p_allow_retire boolean DEFAULT false, p_source_files jsonb DEFAULT '[]'::jsonb)
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
  DELETE FROM _inc_prev WHERE source_comment_id IS NOT NULL;
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