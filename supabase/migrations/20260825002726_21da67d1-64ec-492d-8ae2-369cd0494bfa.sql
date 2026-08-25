-- ============================================================
-- Holding Point 2: Restore preflight / dependency / staging
-- 읽기 전용 분석 함수 + staging 정본 테이블. 운영 테이블 변경 없음.
-- ============================================================

-- 1) 테이블별 스키마 계약 + digest ------------------------------------------
CREATE OR REPLACE FUNCTION public.backup_table_schema_contract(_tables text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  _t text;
  _out jsonb := '[]'::jsonb;
  _exists boolean;
  _cols jsonb;
  _pk text[];
  _fks jsonb;
  _uniq jsonb;
  _canon text;
BEGIN
  FOREACH _t IN ARRAY coalesce(_tables, '{}'::text[]) LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = _t AND c.relkind = 'r'
    ) INTO _exists;

    IF NOT _exists THEN
      _out := _out || jsonb_build_array(jsonb_build_object(
        'name', _t, 'exists', false, 'columns', '[]'::jsonb,
        'primary_key', '[]'::jsonb, 'foreign_keys', '[]'::jsonb,
        'unique_keys', '[]'::jsonb, 'schema_digest', NULL));
      CONTINUE;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
             'name', a.attname,
             'ordinal', a.attnum,
             'type', format_type(a.atttypid, a.atttypmod),
             'nullable', NOT a.attnotnull,
             'has_default', (a.atthasdef OR a.attidentity <> ''),
             'generated', (a.attgenerated <> ''),
             'identity', (a.attidentity <> '')
           ) ORDER BY a.attnum)
      INTO _cols
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = _t
       AND a.attnum > 0 AND NOT a.attisdropped;

    SELECT coalesce(array_agg(att.attname ORDER BY k.ord), '{}'::text[])
      INTO _pk
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE n.nspname = 'public' AND c.relname = _t AND con.contype = 'p';

    SELECT coalesce(jsonb_agg(fk ORDER BY fk->>'constraint_name'), '[]'::jsonb)
      INTO _fks
      FROM (
        SELECT jsonb_build_object(
                 'constraint_name', con.conname,
                 'child_table', c.relname,
                 'child_columns', (SELECT array_agg(att.attname ORDER BY k.ord)
                                     FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                                     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum),
                 'parent_table', pc.relname,
                 'parent_columns', (SELECT array_agg(att.attname ORDER BY k.ord)
                                      FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                                      JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum),
                 'update_rule', con.confupdtype,
                 'delete_rule', con.confdeltype,
                 'deferrable', con.condeferrable
               ) AS fk
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_class pc ON pc.oid = con.confrelid
         WHERE n.nspname = 'public' AND c.relname = _t AND con.contype = 'f'
      ) s;

    SELECT coalesce(jsonb_agg(u ORDER BY u->>'constraint_name'), '[]'::jsonb)
      INTO _uniq
      FROM (
        SELECT jsonb_build_object(
                 'constraint_name', con.conname,
                 'columns', (SELECT array_agg(att.attname ORDER BY k.ord)
                               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum)
               ) AS u
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = _t AND con.contype = 'u'
      ) s;

    -- canonical 직렬화: 컬럼(순서) + PK. 변동값(생성시각 등)은 포함하지 않는다.
    _canon := _t || '|' ||
      coalesce((SELECT string_agg(
          (e->>'name') || ':' || (e->>'ordinal') || ':' || (e->>'type') || ':' ||
          (e->>'nullable') || ':' || (e->>'has_default') || ':' ||
          (e->>'generated') || ':' || (e->>'identity'), ',')
        FROM jsonb_array_elements(_cols) e), '') || '|PK:' || array_to_string(_pk, ',');

    _out := _out || jsonb_build_array(jsonb_build_object(
      'name', _t,
      'exists', true,
      'columns', coalesce(_cols, '[]'::jsonb),
      'primary_key', to_jsonb(_pk),
      'foreign_keys', _fks,
      'unique_keys', _uniq,
      'schema_digest', encode(digest(_canon, 'sha256'), 'hex')
    ));
  END LOOP;

  RETURN _out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_table_schema_contract(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_table_schema_contract(text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_table_schema_contract(text[]) TO service_role;

-- 2) 여러 테이블 지문을 합친 스키마 fingerprint -----------------------------
CREATE OR REPLACE FUNCTION public.backup_schema_fingerprint(_tables text[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
  SELECT encode(digest(
    coalesce(string_agg((e->>'name') || '=' || coalesce(e->>'schema_digest', 'MISSING'), ';'
             ORDER BY e->>'name'), ''), 'sha256'), 'hex')
  FROM jsonb_array_elements(public.backup_table_schema_contract(_tables)) e;
$fn$;

REVOKE ALL ON FUNCTION public.backup_schema_fingerprint(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_schema_fingerprint(text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_schema_fingerprint(text[]) TO service_role;

-- 3) FK 의존 closure ------------------------------------------------------
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
  SELECT coalesce(array_agg(g.table_name::text), '{}'::text[]) INTO _wl
    FROM public.get_backup_tables() AS g(table_name);

  SELECT coalesce(array_agg(DISTINCT x), '{}'::text[]) INTO _req
    FROM unnest(coalesce(_requested, '{}'::text[])) AS x;

  -- 요청 테이블이 화이트리스트 밖이면 즉시 blocker
  SELECT coalesce(array_agg(x), '{}'::text[]) INTO _bad
    FROM unnest(_req) AS x WHERE NOT (x = ANY(_wl));
  IF array_length(_bad, 1) > 0 THEN
    _blockers := _blockers || jsonb_build_array(jsonb_build_object(
      'code', 'TABLE_NOT_IN_WHITELIST',
      'message', '백업 대상 목록에 없는 테이블은 복원 범위에 포함할 수 없습니다.',
      'tables', to_jsonb(_bad)));
  END IF;

  -- 하위 종속 closure (요청 테이블을 참조하는 테이블의 전이 폐쇄)
  WITH RECURSIVE edges AS (
    SELECT c.relname::text AS child, pc.relname::text AS parent
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public' AND pn.nspname = 'public'
  ), down AS (
    SELECT x AS t FROM unnest(_req) AS x
    UNION
    SELECT e.child FROM edges e JOIN down d ON e.parent = d.t WHERE e.child <> e.parent
  )
  SELECT coalesce(array_agg(DISTINCT t), '{}'::text[]) INTO _dependents
    FROM down WHERE NOT (t = ANY(_req));

  -- 화이트리스트 밖 종속 테이블은 blocker
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

  -- 최종 대상이 참조하는 부모 테이블(전이)
  WITH RECURSIVE edges AS (
    SELECT c.relname::text AS child, pc.relname::text AS parent
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class pc ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public' AND pn.nspname = 'public'
  ), up AS (
    SELECT x AS t FROM unnest(_final) AS x
    UNION
    SELECT e.parent FROM edges e JOIN up u ON e.child = u.t WHERE e.child <> e.parent
  )
  SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}'::text[]) INTO _parents
    FROM up WHERE NOT (t = ANY(_final));

  _kept := _parents;

  -- 스냅샷에 없는 필수 테이블
  SELECT coalesce(array_agg(x ORDER BY x), '{}'::text[]) INTO _missing
    FROM unnest(_final) AS x WHERE array_length(_snap, 1) IS NOT NULL AND NOT (x = ANY(_snap));
  IF array_length(_missing, 1) > 0 THEN
    _blockers := _blockers || jsonb_build_array(jsonb_build_object(
      'code', 'REQUIRED_TABLE_MISSING_IN_SNAPSHOT',
      'message', '복원에 필요한 테이블이 이 백업에 포함되어 있지 않습니다.',
      'tables', to_jsonb(_missing)));
  END IF;

  -- self reference 목록(테이블 내부 순환 — 차단하지 않고 표면화)
  SELECT coalesce(array_agg(DISTINCT c.relname::text ORDER BY c.relname::text), '{}'::text[])
    INTO _selfrefs
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.contype = 'f' AND n.nspname = 'public'
     AND con.conrelid = con.confrelid AND c.relname::text = ANY(_final);

  -- Kahn 위상정렬: 부모(참조되는 쪽) 먼저
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

-- 4) restore run 정본 ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restore_runs (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL,
  requested_scope text NOT NULL,
  requested_tables text[] NOT NULL DEFAULT '{}',
  final_restore_tables text[] NOT NULL DEFAULT '{}',
  dependency_result jsonb,
  preflight_result jsonb,
  expected_rows jsonb NOT NULL DEFAULT '{}'::jsonb,
  staged_rows jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_fingerprint text,
  status text NOT NULL DEFAULT 'preflight_running',
  initiated_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restore_runs_status_chk CHECK (status IN (
    'preflight_running','preflight_blocked','preflight_clean','staging','staging_verified','failed'
  ))
);

GRANT SELECT ON public.restore_runs TO authenticated;
GRANT ALL ON public.restore_runs TO service_role;
ALTER TABLE public.restore_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restore_runs_admin_read" ON public.restore_runs;
CREATE POLICY "restore_runs_admin_read" ON public.restore_runs
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]));

CREATE TABLE IF NOT EXISTS public.restore_staging_rows (
  id bigserial PRIMARY KEY,
  restore_run_id uuid NOT NULL REFERENCES public.restore_runs(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  part_index integer NOT NULL,
  part_path text NOT NULL,
  row_sequence integer NOT NULL,
  row_data jsonb NOT NULL,
  row_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restore_staging_rows_uniq UNIQUE (restore_run_id, table_name, row_sequence)
);

CREATE INDEX IF NOT EXISTS restore_staging_rows_run_table_idx
  ON public.restore_staging_rows (restore_run_id, table_name, part_index);

GRANT SELECT ON public.restore_staging_rows TO authenticated;
GRANT ALL ON public.restore_staging_rows TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.restore_staging_rows_id_seq TO service_role;
ALTER TABLE public.restore_staging_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restore_staging_rows_admin_read" ON public.restore_staging_rows;
CREATE POLICY "restore_staging_rows_admin_read" ON public.restore_staging_rows
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]));

CREATE OR REPLACE FUNCTION public.restore_runs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $t$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$t$;

DROP TRIGGER IF EXISTS restore_runs_set_updated_at ON public.restore_runs;
CREATE TRIGGER restore_runs_set_updated_at
  BEFORE UPDATE ON public.restore_runs
  FOR EACH ROW EXECUTE FUNCTION public.restore_runs_touch_updated_at();

-- 5) staging 검산 (읽기 전용, service_role 전용) ---------------------------
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

    -- 허용되지 않은 컬럼
    SELECT coalesce(array_agg(DISTINCT k), '{}'::text[]) INTO _badcols
      FROM public.restore_staging_rows s, jsonb_object_keys(s.row_data) AS k
     WHERE s.restore_run_id=_run_id AND s.table_name=_t AND NOT (k = ANY(_cols));
    IF array_length(_badcols,1) > 0 THEN
      _issues := _issues || jsonb_build_array(jsonb_build_object(
        'code','STAGING_UNKNOWN_COLUMN','table',_t,'columns',to_jsonb(_badcols)));
    END IF;

    -- PK NULL / 중복
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

    -- NOT NULL 위반
    IF array_length(_notnull,1) > 0 THEN
      EXECUTE format(
        'SELECT count(*) FROM public.restore_staging_rows s WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_notnull) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_NOT_NULL_VIOLATION','table',_t,'count',_bad));
      END IF;
    END IF;

    -- unique key 중복
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

    -- FK orphan: 부모가 staging 대상이면 staging 안에서, 아니면 현재 운영 값에서 확인
    FOR _fk IN
      SELECT con.conname,
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
       WHERE con.contype='f' AND n.nspname='public' AND c.relname=_t
    LOOP
      IF array_length(_fk.ccols,1) <> 1 THEN CONTINUE; END IF;
      IF _fk.parent = ANY(_run.final_restore_tables) THEN
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
               AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.%I::text = s.row_data->>%L)',
          _fk.ccols[1], _fk.parent, _fk.pcols[1], _fk.ccols[1])
          INTO _bad USING _run_id, _t;
      END IF;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_FK_ORPHAN','table',_t,'constraint',_fk.conname,'parent',_fk.parent,'count',_bad));
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