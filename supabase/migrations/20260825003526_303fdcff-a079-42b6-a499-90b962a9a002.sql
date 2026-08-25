CREATE OR REPLACE FUNCTION public.restore_staging_verify(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  _run public.restore_runs;
  _t text;
  _pk text[];
  _cols text[];
  _notnull text[];
  _issues jsonb := '[]'::jsonb;
  _per_table jsonb := '[]'::jsonb;
  _staged bigint;
  _expected bigint;
  _bad bigint;
  _badcols text[];
  _fk record;
  _uq record;
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'issues',
      jsonb_build_array(jsonb_build_object('code','RESTORE_RUN_NOT_FOUND','message','복원 준비 작업을 찾을 수 없습니다.')));
  END IF;

  FOREACH _t IN ARRAY _run.final_restore_tables LOOP
    SELECT count(*) INTO _staged FROM public.restore_staging_rows
      WHERE restore_run_id = _run_id AND table_name = _t;
    _expected := coalesce((_run.expected_rows ->> _t)::bigint, 0);

    IF _staged <> _expected THEN
      _issues := _issues || jsonb_build_array(jsonb_build_object(
        'code','STAGING_ROW_COUNT_MISMATCH','table',_t,'expected',_expected,'staged',_staged));
    END IF;

    SELECT coalesce(array_agg(att.attname ORDER BY k.ord), '{}'::text[]) INTO _pk
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE n.nspname='public' AND c.relname = _t AND con.contype='p';

    SELECT coalesce(array_agg(a.attname), '{}'::text[]),
           coalesce(array_agg(a.attname) FILTER (WHERE a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''), '{}'::text[])
      INTO _cols, _notnull
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=_t AND a.attnum>0 AND NOT a.attisdropped;

    SELECT coalesce(array_agg(DISTINCT k), '{}'::text[]) INTO _badcols
      FROM public.restore_staging_rows s, jsonb_object_keys(s.row_data) AS k
     WHERE s.restore_run_id=_run_id AND s.table_name=_t AND NOT (k = ANY(_cols));
    IF array_length(_badcols,1) > 0 THEN
      _issues := _issues || jsonb_build_array(jsonb_build_object(
        'code','STAGING_UNKNOWN_COLUMN','table',_t,'columns',to_jsonb(_badcols)));
    END IF;

    IF array_length(_pk,1) > 0 THEN
      EXECUTE format(
        'SELECT count(*) FROM public.restore_staging_rows s WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_pk) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_PK_NULL','table',_t,'count',_bad));
      END IF;

      EXECUTE format(
        'SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM public.restore_staging_rows s
           WHERE s.restore_run_id=$1 AND s.table_name=$2 GROUP BY %s HAVING count(*)>1) d',
        (SELECT string_agg(format('s.row_data->>%L', col), ', ') FROM unnest(_pk) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_PK_DUPLICATE','table',_t,'count',_bad));
      END IF;
    END IF;

    IF array_length(_notnull,1) > 0 THEN
      EXECUTE format(
        'SELECT count(*) FROM public.restore_staging_rows s WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_notnull) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_NOT_NULL_VIOLATION','table',_t,'count',_bad));
      END IF;
    END IF;

    FOR _uq IN
      SELECT con.conname,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS cols
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE con.contype='u' AND n.nspname='public' AND c.relname=_t
    LOOP
      EXECUTE format(
        'SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM public.restore_staging_rows s
           WHERE s.restore_run_id=$1 AND s.table_name=$2 AND NOT (%s) GROUP BY %s HAVING count(*)>1) d',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_uq.cols) col),
        (SELECT string_agg(format('s.row_data->>%L', col), ', ') FROM unnest(_uq.cols) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_UNIQUE_DUPLICATE','table',_t,'constraint',_uq.conname,'count',_bad));
      END IF;
    END LOOP;

    -- FK orphan: 부모가 복원 대상이면 준비 영역에서, 아니면 현재 운영 값에서 확인.
    -- 부모는 다른 스키마(auth 등)일 수 있으므로 반드시 스키마까지 지정해 조회한다.
    FOR _fk IN
      SELECT con.conname,
             pn.nspname::text AS parent_schema,
             pc.relname::text AS parent,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS ccols,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.confrelid AND att.attnum=k.attnum) AS pcols
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_class pc ON pc.oid=con.confrelid
        JOIN pg_namespace pn ON pn.oid=pc.relnamespace
       WHERE con.contype='f' AND n.nspname='public' AND c.relname=_t
    LOOP
      IF array_length(_fk.ccols,1) <> 1 THEN CONTINUE; END IF;
      IF _fk.parent_schema = 'public' AND _fk.parent = ANY(_run.final_restore_tables) THEN
        EXECUTE format(
          'SELECT count(*) FROM public.restore_staging_rows s
             WHERE s.restore_run_id=$1 AND s.table_name=$2 AND s.row_data->>%L IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.restore_staging_rows p
                    WHERE p.restore_run_id=$1 AND p.table_name=$3 AND p.row_data->>%L = s.row_data->>%L)',
          _fk.ccols[1], _fk.pcols[1], _fk.ccols[1])
          INTO _bad USING _run_id, _t, _fk.parent;
      ELSE
        EXECUTE format(
          'SELECT count(*) FROM public.restore_staging_rows s
             WHERE s.restore_run_id=$1 AND s.table_name=$2 AND s.row_data->>%L IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE p.%I::text = s.row_data->>%L)',
          _fk.ccols[1], _fk.parent_schema, _fk.parent, _fk.pcols[1], _fk.ccols[1])
          INTO _bad USING _run_id, _t;
      END IF;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_FK_ORPHAN','table',_t,'constraint',_fk.conname,
          'parent', _fk.parent_schema || '.' || _fk.parent,'count',_bad));
      END IF;
    END LOOP;

    _per_table := _per_table || jsonb_build_array(jsonb_build_object(
      'table', _t, 'expected_rows', _expected, 'staged_rows', _staged));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(_issues) = 0,
    'run_id', _run_id,
    'tables', _per_table,
    'issues', _issues
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.restore_staging_verify(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_staging_verify(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_staging_verify(uuid) TO service_role;