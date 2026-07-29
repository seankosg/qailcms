CREATE OR REPLACE FUNCTION public.abd_aconex_apply_diffs(_batch_id uuid, _patches jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_row_count int;
  v_uid uuid := auth.uid();
  p jsonb;
  doc_no text;
  set_sql text;
  k text;
  v jsonb;
  v_allowed_fields constant text[] := ARRAY[
    'latest_status',
    'latest_rev',
    'approval_date',
    'aconex_status_raw',
    'aconex_review_status_raw',
    'aconex_date_modified',
    'r1_dar_actual',
    'r2_dar_actual',
    'r3_dar_actual',
    'r1_response_result',
    'r2_response_result',
    'r3_response_result',
    'is_terminated',
    'is_active',
    'inactive_reason'
  ];
  v_forbidden_actual_fields constant text[] := ARRAY[
    'r1_submission_actual',
    'r2_submission_actual',
    'r3_submission_actual',
    'r1_draft_start_actual',
    'r2_draft_start_actual',
    'r3_draft_start_actual',
    'r1_draft_finish_actual',
    'r2_draft_finish_actual',
    'r3_draft_finish_actual'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'superuser'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: admin/superuser only';
  END IF;
  IF _patches IS NULL OR jsonb_typeof(_patches) <> 'array' THEN
    RETURN 0;
  END IF;

  -- change_log trigger 가 이 세션 GUC 를 읽어 source/upload_id 를 기록
  PERFORM set_config('app.change_source', 'aconex', true);
  PERFORM set_config('app.upload_id', _batch_id::text, true);

  FOR p IN SELECT value FROM jsonb_array_elements(_patches) AS t(value)
  LOOP
    doc_no := p->>'document_no';
    IF doc_no IS NULL OR length(doc_no) = 0 THEN
      CONTINUE;
    END IF;

    set_sql := '';
    FOR k, v IN SELECT key, value FROM jsonb_each(p)
    LOOP
      IF k = 'document_no' THEN
        CONTINUE;
      END IF;

      -- Aconex 정본 범위: Draft/Submission actual 은 HDEC 파일만 쓸 수 있다.
      -- stale/legacy 번들이 금지 필드를 보내면 조용히 무시하지 않고 즉시 실패시켜 재오염을 차단한다.
      IF k = ANY(v_forbidden_actual_fields) THEN
        RAISE EXCEPTION 'forbidden Aconex field: %', k;
      END IF;

      IF NOT (k = ANY(v_allowed_fields)) THEN
        RAISE EXCEPTION 'unsupported Aconex field: %', k;
      END IF;

      IF set_sql <> '' THEN
        set_sql := set_sql || ', ';
      END IF;
      IF jsonb_typeof(v) = 'null' THEN
        set_sql := set_sql || format('%I = NULL', k);
      ELSE
        set_sql := set_sql || format('%I = %L', k, (p->>k));
      END IF;
    END LOOP;

    IF set_sql = '' THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.abd_items_raw SET %s, aconex_last_synced_at = now(), source_import_log_id = %L, updated_at = now(), updated_by = %L WHERE abd_number = %L',
      set_sql, _batch_id::text, v_uid::text, doc_no
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_updated := v_updated + v_row_count;
  END LOOP;

  RETURN v_updated;
END;
$function$;