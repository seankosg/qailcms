-- 트리거 제어 헬퍼
CREATE OR REPLACE FUNCTION public.backup_disable_triggers(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', _table_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.backup_enable_triggers(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', _table_name);
END;
$$;

-- 테이블 비우기 (외래키 제약이 있을 경우 CASCADE 옵션 포함)
CREATE OR REPLACE FUNCTION public.backup_truncate_table(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('TRUNCATE TABLE %I CASCADE', _table_name);
END;
$$;

-- JSONB 행 일괄 삽입 (컬럼 목록을 information_schema에서 동적으로 구성)
CREATE OR REPLACE FUNCTION public.backup_insert_rows_from_json(_table_name text, _rows_json jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cols text;
  insert_sql text;
  inserted_count bigint;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = _table_name;

  IF cols IS NULL THEN
    RAISE EXCEPTION 'Table % not found in public schema', _table_name;
  END IF;

  insert_sql := format(
    'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%I, $1)',
    _table_name, cols, cols, _table_name
  );

  EXECUTE insert_sql USING _rows_json;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- 권한 제한
REVOKE EXECUTE ON FUNCTION public.backup_disable_triggers(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backup_enable_triggers(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backup_truncate_table(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backup_insert_rows_from_json(text, jsonb) FROM anon;

GRANT EXECUTE ON FUNCTION public.backup_disable_triggers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_enable_triggers(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_truncate_table(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backup_insert_rows_from_json(text, jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.backup_disable_triggers(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_enable_triggers(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_truncate_table(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_insert_rows_from_json(text, jsonb) TO service_role;