DROP FUNCTION IF EXISTS public.abd_aconex_apply_diffs(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.abd_aconex_apply_diffs(
  _batch_id uuid,
  _patches jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_row_count int;
  v_uid uuid := auth.uid();
  p jsonb;
  doc_no text;
  set_sql text;
  k text;
  v jsonb;
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
      IF set_sql <> '' THEN
        set_sql := set_sql || ', ';
      END IF;
      IF jsonb_typeof(v) = 'null' THEN
        set_sql := set_sql || format('%I = NULL', k);
      ELSE
        -- Postgres implicit-casts text literal to the column's type at assignment.
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
$$;

REVOKE ALL ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) TO service_role;