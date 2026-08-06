-- 1) 기존 정본 로직을 core 로 이름만 변경 (본문 불변)
ALTER FUNCTION public.abd_ocs_inc_import(uuid, uuid, boolean, jsonb)
  RENAME TO abd_ocs_inc_import_core;

REVOKE ALL ON FUNCTION public.abd_ocs_inc_import_core(uuid, uuid, boolean, jsonb) FROM anon, authenticated;

-- 2) 신 시그니처: source metadata 등록을 같은 트랜잭션 안에서 수행
CREATE OR REPLACE FUNCTION public.abd_ocs_inc_import(
  p_run uuid,
  p_import_log_id uuid,
  p_allow_retire boolean DEFAULT false,
  p_source_files jsonb DEFAULT '[]'::jsonb,
  p_source_meta jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
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
  ), checked AS (
    SELECT * FROM src
  ), ins AS (
    INSERT INTO public.abd_ocs_source_files
      (source_file_id, file_name, relative_path, storage_path, content_hash, byte_size, mime_type, uploaded_by)
    SELECT source_file_id, file_name, relative_path, storage_path, content_hash, byte_size, mime_type, auth.uid()
    FROM checked
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

  v_result := public.abd_ocs_inc_import_core(p_run, p_import_log_id, p_allow_retire, p_source_files);

  RETURN v_result || jsonb_build_object('source_files_registered', v_src);
END
$$;

GRANT EXECUTE ON FUNCTION public.abd_ocs_inc_import(uuid, uuid, boolean, jsonb, jsonb) TO authenticated;