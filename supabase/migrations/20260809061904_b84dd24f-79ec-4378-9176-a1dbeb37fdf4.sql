-- 1) staging: 이미지 metadata 컬럼 (과거 V3 staging 호환 위해 nullable)
ALTER TABLE public.abd_ocs_v3_stage_attachments
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS byte_size bigint,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS image_format text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS source_image_index integer;

-- 2) staging loader: 전 필드 INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.abd_ocs_v3_stage_load_attachments(p_run uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  INSERT INTO public.abd_ocs_v3_stage_attachments AS t (
    stage_run_id, attachment_id, comment_id, source_parent_comment_id,
    comment_group_id, atomic_comment_id, attachment_scope,
    storage_path, content_hash, byte_size, width, height,
    image_format, mime_type, source_image_index
  )
  SELECT p_run,
         COALESCE(NULLIF(x->>'source_attachment_id',''), x->>'attachment_id'),
         NULLIF(x->>'comment_id',''),
         NULLIF(x->>'source_parent_comment_id',''),
         NULLIF(x->>'comment_group_id',''),
         NULLIF(x->>'atomic_comment_id',''),
         NULLIF(x->>'attachment_scope',''),
         NULLIF(x->>'storage_path',''),
         lower(NULLIF(x->>'content_hash','')),
         NULLIF(x->>'byte_size','')::bigint,
         NULLIF(x->>'width','')::int,
         NULLIF(x->>'height','')::int,
         NULLIF(x->>'image_format',''),
         NULLIF(x->>'mime_type',''),
         NULLIF(x->>'source_image_index','')::int
  FROM jsonb_array_elements(p_rows) x
  ON CONFLICT (stage_run_id, attachment_id) DO UPDATE SET
    comment_id = EXCLUDED.comment_id,
    source_parent_comment_id = EXCLUDED.source_parent_comment_id,
    comment_group_id = EXCLUDED.comment_group_id,
    atomic_comment_id = EXCLUDED.atomic_comment_id,
    attachment_scope = EXCLUDED.attachment_scope,
    storage_path = EXCLUDED.storage_path,
    content_hash = EXCLUDED.content_hash,
    byte_size = EXCLUDED.byte_size,
    width = EXCLUDED.width,
    height = EXCLUDED.height,
    image_format = EXCLUDED.image_format,
    mime_type = EXCLUDED.mime_type,
    source_image_index = EXCLUDED.source_image_index;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('loaded', v_n,
    'total', (SELECT count(*) FROM public.abd_ocs_v3_stage_attachments WHERE stage_run_id = p_run));
END $function$;

-- 3) Dry-run 보조 집계 — 읽기 전용
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_attachment_stats(p_run uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sa AS (
    SELECT s.*,
           ai.storage_path AS db_path_by_id, ai.content_hash AS db_hash_by_id,
           ap.source_attachment_id AS db_id_by_path, ap.content_hash AS db_hash_by_path
    FROM public.abd_ocs_v3_stage_attachments s
    LEFT JOIN public.abd_ocs_attachments ai ON ai.source_attachment_id = s.attachment_id
    LEFT JOIN public.abd_ocs_attachments ap ON s.storage_path IS NOT NULL AND ap.storage_path = s.storage_path
    WHERE s.stage_run_id = p_run
  ), cls AS (
    SELECT sa.*,
      CASE
        WHEN db_path_by_id IS NULL AND db_id_by_path IS NULL
          AND (storage_path IS NULL OR content_hash IS NULL OR byte_size IS NULL) THEN 'metadata_missing'
        WHEN db_path_by_id IS NOT NULL AND db_hash_by_id IS NULL THEN 'metadata_missing'
        WHEN db_id_by_path IS NOT NULL AND db_hash_by_path IS NULL THEN 'metadata_missing'
        WHEN db_path_by_id IS NOT NULL AND storage_path IS NOT NULL AND db_path_by_id <> storage_path THEN 'hash_conflict'
        WHEN db_hash_by_id IS NOT NULL AND content_hash IS NOT NULL AND db_hash_by_id <> content_hash THEN 'hash_conflict'
        WHEN db_id_by_path IS NOT NULL AND db_id_by_path <> attachment_id THEN 'hash_conflict'
        WHEN db_hash_by_path IS NOT NULL AND content_hash IS NOT NULL AND db_hash_by_path <> content_hash THEN 'hash_conflict'
        WHEN db_path_by_id IS NOT NULL THEN 'existing'
        ELSE 'new'
      END AS state
    FROM sa
  ), pairs AS (
    SELECT s.attachment_id, c.source_comment_id
    FROM public.abd_ocs_v3_stage_attachments s
    JOIN public.abd_ocs_comments c ON c.source_comment_id = s.atomic_comment_id
    WHERE s.stage_run_id = p_run AND s.attachment_scope = 'single' AND s.atomic_comment_id IS NOT NULL
    UNION
    SELECT s.attachment_id, sc.source_comment_id
    FROM public.abd_ocs_v3_stage_attachments s
    JOIN public.abd_ocs_v3_stage_comments sc
      ON sc.stage_run_id = p_run AND sc.comment_group_id = s.comment_group_id
    WHERE s.stage_run_id = p_run AND s.attachment_scope = 'group' AND s.comment_group_id IS NOT NULL
  ), pair_state AS (
    SELECT p.*, l.id AS link_id
    FROM pairs p
    LEFT JOIN public.abd_ocs_attachment_comment_links l
      ON l.source_attachment_id = p.attachment_id AND l.source_comment_id = p.source_comment_id
  )
  SELECT jsonb_build_object(
    'attachments_new', (SELECT count(*) FROM cls WHERE state = 'new'),
    'attachments_existing', (SELECT count(*) FROM cls WHERE state = 'existing'),
    'attachments_hash_conflict', (SELECT count(*) FROM cls WHERE state = 'hash_conflict'),
    'attachments_metadata_missing', (SELECT count(*) FROM cls WHERE state = 'metadata_missing'),
    'attachment_link_pairs_new', (SELECT count(*) FROM pair_state WHERE link_id IS NULL),
    'attachment_link_pairs_existing', (SELECT count(*) FROM pair_state WHERE link_id IS NOT NULL)
  )
$function$;

-- 4) 신규 이미지 metadata 등록 — 교차 충돌은 EXCEPTION 으로 전체 롤백
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
  DELETE FROM _inc_img;

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
  SELECT string_agg(format('%s (db %s/%s ≠ pkg %s/%s)', m.source_attachment_id,
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
  SELECT string_agg(format('%s (db id %s ≠ pkg id %s)', m.storage_path,
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

-- 5) 증분 Import — p_image_meta 추가 (구 시그니처 DROP)
DROP FUNCTION IF EXISTS public.abd_ocs_inc_import(uuid, uuid, boolean, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.abd_ocs_inc_import(
  p_run uuid,
  p_import_log_id uuid,
  p_allow_retire boolean DEFAULT false,
  p_source_files jsonb DEFAULT '[]'::jsonb,
  p_source_meta jsonb DEFAULT '[]'::jsonb,
  p_image_meta jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_img jsonb;
  v_src int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  IF jsonb_typeof(COALESCE(p_source_meta, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_source_meta must be a json array';
  END IF;

  WITH src AS (
    SELECT
      NULLIF(e->>'source_file_id','')  AS source_file_id,
      NULLIF(e->>'file_name','')       AS file_name,
      NULLIF(e->>'relative_path','')   AS relative_path,
      NULLIF(e->>'storage_path','')    AS storage_path,
      NULLIF(e->>'content_hash','')    AS content_hash,
      COALESCE((e->>'byte_size')::bigint, 0) AS byte_size,
      COALESCE(NULLIF(e->>'mime_type',''),
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') AS mime_type
    FROM jsonb_array_elements(COALESCE(p_source_meta,'[]'::jsonb)) e
  ), ins AS (
    INSERT INTO public.abd_ocs_source_files
      (source_file_id, file_name, relative_path, storage_path, content_hash, byte_size, mime_type, uploaded_by)
    SELECT source_file_id, file_name, relative_path, storage_path, content_hash, byte_size, mime_type, auth.uid()
    FROM src
    ON CONFLICT (source_file_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_src FROM ins;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_source_meta,'[]'::jsonb)) e
    WHERE NULLIF(e->>'source_file_id','') IS NULL
       OR NULLIF(e->>'file_name','') IS NULL
       OR NULLIF(e->>'relative_path','') IS NULL
       OR NULLIF(e->>'storage_path','') IS NULL
       OR NULLIF(e->>'content_hash','') IS NULL
  ) THEN
    RAISE EXCEPTION 'p_source_meta entries require source_file_id, file_name, relative_path, storage_path, content_hash';
  END IF;

  -- 이미지 metadata 검증·등록은 정본 반영(abd_ocs_v3_import) 보다 반드시 먼저 수행한다.
  v_img := public.abd_ocs_inc_register_images(p_run, COALESCE(p_image_meta,'[]'::jsonb));

  v_result := public.abd_ocs_inc_import_core(p_run, p_import_log_id, p_allow_retire, p_source_files);

  RETURN v_result || jsonb_build_object('source_files_registered', v_src, 'images', v_img);
END
$function$;