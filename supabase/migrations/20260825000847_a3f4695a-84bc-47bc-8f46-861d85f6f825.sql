-- 6.2 backup_claim_run: PUBLIC/anon/authenticated EXECUTE 회수
REVOKE EXECUTE ON FUNCTION public.backup_claim_run(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backup_claim_run(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backup_claim_run(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backup_claim_run(uuid, jsonb) TO service_role;

-- 7. 파괴적 RPC 화이트리스트 (정본: public.get_backup_tables())
CREATE OR REPLACE FUNCTION public.backup_assert_table_allowed(_table_name text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _table_name IS NULL OR _table_name = '' THEN
    RAISE EXCEPTION 'BACKUP_TABLE_NOT_ALLOWED: empty table name';
  END IF;
  IF NOT (_table_name = ANY (public.get_backup_tables())) THEN
    RAISE EXCEPTION 'BACKUP_TABLE_NOT_ALLOWED: %', _table_name;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backup_assert_table_allowed(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backup_assert_table_allowed(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backup_assert_table_allowed(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backup_assert_table_allowed(text) TO service_role;

CREATE OR REPLACE FUNCTION public.backup_disable_triggers(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.backup_assert_table_allowed(_table_name);
  EXECUTE format('ALTER TABLE %I DISABLE TRIGGER ALL', _table_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.backup_enable_triggers(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.backup_assert_table_allowed(_table_name);
  EXECUTE format('ALTER TABLE %I ENABLE TRIGGER ALL', _table_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.backup_truncate_table(_table_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.backup_assert_table_allowed(_table_name);
  EXECUTE format('TRUNCATE TABLE %I CASCADE', _table_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.backup_insert_rows_from_json(_table_name text, _rows_json jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cols text;
  insert_sql text;
  inserted_count bigint;
BEGIN
  PERFORM public.backup_assert_table_allowed(_table_name);

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
$function$;

REVOKE EXECUTE ON FUNCTION public.backup_disable_triggers(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backup_enable_triggers(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backup_truncate_table(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backup_insert_rows_from_json(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_disable_triggers(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_enable_triggers(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_truncate_table(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_insert_rows_from_json(text, jsonb) TO service_role;