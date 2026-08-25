CREATE OR REPLACE FUNCTION public.backup_dependency_closure(
  _requested text[],
  _snapshot_tables text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  _wl text[];
  _req text[];
  _snap text[] := coalesce(_snapshot_tables, '{}'::text[]);
  _final text[];
  _dependents text[];
  _parents text[];
  _auto text[];
  _kept text[];
  _blockers jsonb := '[]'::jsonb;
  _cycles jsonb := '[]'::jsonb;
  _selfrefs text[];
  _insert_order text[] := '{}'::text[];
  _remaining text[];
  _t text;
  _progress boolean;
  _bad text[];
  _missing text[];
BEGIN
  _wl := coalesce(public.get_backup_tables(), '{}'::text[]);

  SELECT coalesce(array_agg(DISTINCT x), '{}'::text[]) INTO _req
    FROM unnest(coalesce(_requested, '{}'::text[])) AS x;

  SELECT coalesce(array_agg(x), '{}'::text[]) INTO _bad
    FROM unnest(_req) AS x WHERE NOT (x = ANY(_wl));
  IF array_length(_bad, 1) > 0 THEN
    _blockers := _blockers || jsonb_build_array(jsonb_build_object(
      'code', 'TABLE_NOT_IN_WHITELIST',
      'message', '백업 대상 목록에 없는 테이블은 복원 범위에 포함할 수 없습니다.',
      'tables', to_jsonb(_bad)));
  END IF;

  WITH RECURSIVE edges AS (
    SELECT (c.relname::text COLLATE "C") AS child, (pc.relname::text COLLATE "C") AS parent
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public' AND pn.nspname = 'public'
  ), down AS (
    SELECT (x::text COLLATE "C") AS t FROM unnest(_req) AS x
    UNION
    SELECT e.child FROM edges e JOIN down d ON e.parent = d.t WHERE e.child <> e.parent
  )
  SELECT coalesce(array_agg(DISTINCT t::text), '{}'::text[]) INTO _dependents
    FROM down WHERE NOT (t = ANY(_req));

  SELECT coalesce(array_agg(x), '{}'::text[]) INTO _bad
    FROM unnest(_dependents) AS x WHERE NOT (x = ANY(_wl));
  IF array_length(_bad, 1) > 0 THEN
    _blockers := _blockers || jsonb_build_array(jsonb_build_object(
      'code', 'DEPENDENT_TABLE_NOT_WHITELISTED',
      'message', '요청 테이블을 참조하는 테이블이 백업 대상 목록에 없어 복원 준비를 진행할 수 없습니다.',
      'tables', to_jsonb(_bad)));
  END IF;

  _auto := ARRAY(SELECT x FROM unnest(_dependents) AS x WHERE x = ANY(_wl) ORDER BY x);
  _final := ARRAY(SELECT DISTINCT x FROM unnest(_req || _auto) AS x WHERE x = ANY(_wl) ORDER BY x);

  WITH RECURSIVE edges AS (
    SELECT (c.relname::text COLLATE "C") AS child, (pc.relname::text COLLATE "C") AS parent
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public' AND pn.nspname = 'public'
  ), up AS (
    SELECT (x::text COLLATE "C") AS t FROM unnest(_final) AS x
    UNION
    SELECT e.parent FROM edges e JOIN up u ON e.child = u.t WHERE e.child <> e.parent
  )
  SELECT coalesce(array_agg(DISTINCT t::text ORDER BY t::text), '{}'::text[]) INTO _parents
    FROM up WHERE NOT (t = ANY(_final));

  _kept := _parents;

  SELECT coalesce(array_agg(x ORDER BY x), '{}'::text[]) INTO _missing
    FROM unnest(_final) AS x WHERE array_length(_snap, 1) IS NOT NULL AND NOT (x = ANY(_snap));
  IF array_length(_missing, 1) > 0 THEN
    _blockers := _blockers || jsonb_build_array(jsonb_build_object(
      'code', 'REQUIRED_TABLE_MISSING_IN_SNAPSHOT',
      'message', '복원에 필요한 테이블이 이 백업에 포함되어 있지 않습니다.',
      'tables', to_jsonb(_missing)));
  END IF;

  SELECT coalesce(array_agg(DISTINCT c.relname::text ORDER BY c.relname::text), '{}'::text[])
    INTO _selfrefs
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f' AND n.nspname = 'public'
     AND con.conrelid = con.confrelid AND c.relname::text = ANY(_final);

  _remaining := _final;
  LOOP
    EXIT WHEN array_length(_remaining, 1) IS NULL;
    _progress := false;
    FOREACH _t IN ARRAY _remaining LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_class pc ON pc.oid = con.confrelid
         WHERE con.contype = 'f' AND n.nspname = 'public'
           AND c.relname::text = _t
           AND pc.relname::text <> _t
           AND pc.relname::text = ANY(_remaining)
      ) THEN
        _insert_order := _insert_order || _t;
        _remaining := ARRAY(SELECT x FROM unnest(_remaining) AS x WHERE x <> _t);
        _progress := true;
      END IF;
    END LOOP;
    IF NOT _progress THEN
      _cycles := _cycles || jsonb_build_array(jsonb_build_object('tables', to_jsonb(_remaining)));
      _blockers := _blockers || jsonb_build_array(jsonb_build_object(
        'code', 'FK_CYCLE_DETECTED',
        'message', '테이블 사이에 순환 참조가 있어 복원 순서를 결정할 수 없습니다.',
        'tables', to_jsonb(_remaining)));
      _insert_order := _insert_order || _remaining;
      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'requested_tables', to_jsonb(_req),
    'dependent_tables', to_jsonb(coalesce(_dependents, '{}'::text[])),
    'required_parent_tables', to_jsonb(_parents),
    'auto_included_tables', to_jsonb(_auto),
    'keep_current_parent_tables', to_jsonb(_kept),
    'final_restore_tables', to_jsonb(_final),
    'insert_order', to_jsonb(_insert_order),
    'remove_order', to_jsonb(ARRAY(SELECT x FROM unnest(_insert_order) WITH ORDINALITY AS u(x, i) ORDER BY i DESC)),
    'missing_in_snapshot', to_jsonb(_missing),
    'self_reference_tables', to_jsonb(_selfrefs),
    'cycle_groups', _cycles,
    'blockers', _blockers
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_dependency_closure(text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_dependency_closure(text[], text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_dependency_closure(text[], text[]) TO service_role;