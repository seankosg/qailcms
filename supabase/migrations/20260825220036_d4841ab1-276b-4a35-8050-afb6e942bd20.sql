-- ============================================================================
-- 안전 복원 Holding Point 3 — 원자적 반영 엔진 (엔진만; 실행/UI 활성화 없음)
-- 금지 준수: TRUNCATE 미사용, 트리거/제약 비활성화 없음, session_replication_role 미변경,
--            legacy 복원 함수 재사용 없음, PUBLIC/anon/authenticated 실행권한 부여 없음.
-- ============================================================================

ALTER TABLE public.restore_runs
  ADD COLUMN IF NOT EXISTS staging_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS staging_digest jsonb,
  ADD COLUMN IF NOT EXISTS staging_overall_digest text,
  ADD COLUMN IF NOT EXISTS safety_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS safety_snapshot_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS apply_result jsonb,
  ADD COLUMN IF NOT EXISTS applied_by uuid,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 표 단위 정규화 지문
--    준비 영역(jsonb) 과 운영 표(실제 행) 를 동일한 정규형으로 환산해 비교한다.
--    생성 컬럼(generated) 은 재계산 값이므로 지문에서 제외한다.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_row_digest(_run_id uuid, _table text, _source text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _gen text[];
  _minus text := '';
  _g text;
  _rows bigint;
  _digest text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = _table AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'RESTORE_TABLE_NOT_FOUND: %', _table;
  END IF;

  SELECT coalesce(array_agg(a.attname), '{}'::text[]) INTO _gen
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = _table
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '';

  FOREACH _g IN ARRAY _gen LOOP
    _minus := _minus || format(' - %L::text', _g);
  END LOOP;

  IF _source = 'staging' THEN
    EXECUTE format($q$
      SELECT count(*)::bigint,
             encode(digest(coalesce(string_agg(t.j, E'\n' ORDER BY t.j COLLATE "C"), ''), 'sha256'), 'hex')
        FROM (
          SELECT ((to_jsonb(r) %s))::text AS j
            FROM public.restore_staging_rows s,
                 LATERAL jsonb_populate_record(NULL::public.%I, s.row_data) r
           WHERE s.restore_run_id = $1 AND s.table_name = $2
        ) t
    $q$, _minus, _table)
    INTO _rows, _digest USING _run_id, _table;
  ELSIF _source = 'live' THEN
    EXECUTE format($q$
      SELECT count(*)::bigint,
             encode(digest(coalesce(string_agg(t.j, E'\n' ORDER BY t.j COLLATE "C"), ''), 'sha256'), 'hex')
        FROM (SELECT ((to_jsonb(x) %s))::text AS j FROM public.%I x) t
    $q$, _minus, _table)
    INTO _rows, _digest;
  ELSE
    RAISE EXCEPTION 'RESTORE_DIGEST_SOURCE_INVALID: %', _source;
  END IF;

  RETURN jsonb_build_object('table', _table, 'source', _source, 'rows', _rows, 'digest', _digest);
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_row_digest(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_row_digest(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_row_digest(uuid, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 준비 영역 전체 지문 (표 단위 + overall)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_staging_digest(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _t text;
  _one jsonb;
  _tables jsonb := '[]'::jsonb;
  _parts text := '';
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;

  FOREACH _t IN ARRAY coalesce(_run.final_restore_tables, '{}'::text[]) LOOP
    _one := public.restore_row_digest(_run_id, _t, 'staging');
    _tables := _tables || jsonb_build_array(_one);
    _parts := _parts || format('%s=%s:%s;', _t, _one->>'rows', _one->>'digest');
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', _run_id,
    'tables', _tables,
    'overall', encode(digest(_parts, 'sha256'), 'hex')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_staging_digest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_staging_digest(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_staging_digest(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 준비 영역 지문 고정 (staging_verified 상태에서만)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_pin_staging_digest(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _d jsonb;
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
  IF _run.status <> 'staging_verified' THEN
    RAISE EXCEPTION 'RESTORE_STAGING_NOT_VERIFIED: status=%', _run.status;
  END IF;

  _d := public.restore_staging_digest(_run_id);

  IF _run.staging_overall_digest IS NOT NULL
     AND _run.staging_overall_digest <> (_d->>'overall') THEN
    RAISE EXCEPTION 'RESTORE_STAGING_CHANGED_AFTER_PIN';
  END IF;

  UPDATE public.restore_runs
     SET staging_digest = _d->'tables',
         staging_overall_digest = _d->>'overall',
         staging_verified_at = coalesce(staging_verified_at, now()),
         updated_at = now()
   WHERE id = _run_id;

  RETURN _d;
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_pin_staging_digest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_pin_staging_digest(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_pin_staging_digest(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 안전 스냅샷 결속 (복원 직전 백업 없으면 반영 불가)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_bind_safety_snapshot(_run_id uuid, _snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _snap public.database_snapshots;
  _missing text[];
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
  IF _run.status <> 'staging_verified' THEN
    RAISE EXCEPTION 'RESTORE_STAGING_NOT_VERIFIED: status=%', _run.status;
  END IF;
  IF _snapshot_id = _run.snapshot_id THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_SAME_AS_SOURCE';
  END IF;

  SELECT * INTO _snap FROM public.database_snapshots WHERE id = _snapshot_id;
  IF _snap.id IS NULL THEN RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_NOT_FOUND'; END IF;
  IF _snap.sha256_hash IS NULL OR _snap.metadata IS NULL THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_INCOMPLETE';
  END IF;
  IF coalesce(_snap.metadata->>'schema_version', '') <> 'qail-snapshot-v2' THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.backup_run_log
     WHERE snapshot_id = _snapshot_id AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_NOT_SUCCESSFUL';
  END IF;
  IF _run.staging_verified_at IS NOT NULL AND _snap.created_at < _run.staging_verified_at THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_TOO_OLD';
  END IF;

  -- 복원 대상 표 전체가 안전 스냅샷에 포함되어야 한다.
  SELECT coalesce(array_agg(t), '{}'::text[]) INTO _missing
    FROM unnest(coalesce(_run.final_restore_tables, '{}'::text[])) t
   WHERE NOT (t = ANY(coalesce(_snap.tables_included, '{}'::text[])));
  IF array_length(_missing, 1) > 0 THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_TABLE_MISSING: %', array_to_string(_missing, ',');
  END IF;

  UPDATE public.database_snapshots SET is_locked = true WHERE id = _snapshot_id;

  UPDATE public.restore_runs
     SET safety_snapshot_id = _snapshot_id,
         safety_snapshot_bound_at = now(),
         updated_at = now()
   WHERE id = _run_id;

  RETURN jsonb_build_object('run_id', _run_id, 'safety_snapshot_id', _snapshot_id, 'bound', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_bind_safety_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_bind_safety_snapshot(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_bind_safety_snapshot(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) 원자적 반영 엔진
--    단일 트랜잭션: 상태 점유 → 지문 재검증 → ACCESS EXCLUSIVE 잠금 →
--    remove_order DELETE → insert_order INSERT → 사후 지문 검산 →
--    범위 밖 권한표 불변 검산 → sequence 재조정 → success 기록.
--    한 건이라도 실패하면 RAISE 로 전체 롤백된다.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_apply_atomic(
  _run_id uuid,
  _expected_overall_digest text,
  _actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _insert_order text[];
  _remove_order text[];
  _t text;
  _cols text[];
  _collist text;
  _sellist text;
  _ident boolean;
  _deleted bigint;
  _inserted bigint;
  _live jsonb;
  _stg jsonb;
  _per jsonb := '[]'::jsonb;
  _guard text[];
  _guard_before jsonb := '{}'::jsonb;
  _guard_after jsonb := '{}'::jsonb;
  _g text;
  _seq text;
  _c record;
  _seqs jsonb := '[]'::jsonb;
  _d jsonb;
  _fp text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('qail_safe_restore_apply')) THEN
    RAISE EXCEPTION 'RESTORE_APPLY_ALREADY_RUNNING';
  END IF;
  SET LOCAL lock_timeout = '15s';

  -- 5-1) 상태 원자 점유 (중복 실행 차단)
  UPDATE public.restore_runs
     SET status = 'applying', applied_by = _actor, applied_at = now(), updated_at = now()
   WHERE id = _run_id AND status = 'staging_verified'
  RETURNING * INTO _run;

  IF _run.id IS NULL THEN
    SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
    IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
    RAISE EXCEPTION 'RESTORE_APPLY_NOT_CLAIMABLE: status=%', _run.status;
  END IF;

  -- 5-2) 관문: 안전 스냅샷 / 고정 지문 / 검산 결과
  IF _run.safety_snapshot_id IS NULL THEN RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_MISSING'; END IF;
  IF _run.staging_overall_digest IS NULL THEN RAISE EXCEPTION 'RESTORE_STAGING_DIGEST_MISSING'; END IF;
  IF _expected_overall_digest IS NULL OR _expected_overall_digest <> _run.staging_overall_digest THEN
    RAISE EXCEPTION 'RESTORE_STAGING_DIGEST_MISMATCH';
  END IF;
  IF coalesce((_run.staging_verify->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RESTORE_STAGING_VERIFY_NOT_CLEAN';
  END IF;

  _fp := public.backup_schema_fingerprint(_run.final_restore_tables);
  IF _run.schema_fingerprint IS DISTINCT FROM _fp THEN
    RAISE EXCEPTION 'RESTORE_SCHEMA_CHANGED_BEFORE_APPLY';
  END IF;

  _d := public.restore_staging_digest(_run_id);
  IF (_d->>'overall') <> _run.staging_overall_digest THEN
    RAISE EXCEPTION 'RESTORE_STAGING_CHANGED_AFTER_VERIFY';
  END IF;

  -- 5-3) 순서 계약 (사전검증 결과만 신뢰)
  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _insert_order
    FROM jsonb_array_elements_text(coalesce(_run.dependency_result->'insert_order', '[]'::jsonb))
         WITH ORDINALITY AS u(v, i);
  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _remove_order
    FROM jsonb_array_elements_text(coalesce(_run.dependency_result->'remove_order', '[]'::jsonb))
         WITH ORDINALITY AS u(v, i);

  IF array_length(_insert_order, 1) IS NULL OR array_length(_remove_order, 1) IS NULL THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_MISSING';
  END IF;
  IF NOT (_insert_order @> _run.final_restore_tables AND _run.final_restore_tables @> _insert_order) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_MISMATCH';
  END IF;

  -- 5-4) 범위 밖 권한·사용자 표 불변 기준값
  SELECT coalesce(array_agg(t), '{}'::text[]) INTO _guard
    FROM unnest(ARRAY['profiles','user_roles','rcl_permissions','rcl_module_config']) t
   WHERE NOT (t = ANY(_run.final_restore_tables));
  FOREACH _g IN ARRAY _guard LOOP
    _guard_before := _guard_before || jsonb_build_object(_g, public.restore_row_digest(_run_id, _g, 'live')->>'digest');
  END LOOP;

  -- 5-5) 대상 표 잠금 (TRUNCATE 미사용, 트리거·제약 유지)
  FOREACH _t IN ARRAY _insert_order LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', _t);
  END LOOP;

  -- 5-6) 삭제 (자식 → 부모)
  FOREACH _t IN ARRAY _remove_order LOOP
    EXECUTE format('DELETE FROM public.%I', _t);
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    _per := _per || jsonb_build_array(jsonb_build_object('table', _t, 'deleted', _deleted));
  END LOOP;

  -- 5-7) 삽입 (부모 → 자식)
  FOREACH _t IN ARRAY _insert_order LOOP
    SELECT coalesce(array_agg(a.attname ORDER BY a.attnum), '{}'::text[]),
           bool_or(a.attidentity = 'a')
      INTO _cols, _ident
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = _t
       AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';

    IF array_length(_cols, 1) IS NULL THEN
      RAISE EXCEPTION 'RESTORE_TABLE_HAS_NO_COLUMNS: %', _t;
    END IF;

    SELECT string_agg(format('%I', c), ', '), string_agg(format('r.%I', c), ', ')
      INTO _collist, _sellist
      FROM unnest(_cols) WITH ORDINALITY AS u(c, i);

    EXECUTE format(
      'INSERT INTO public.%I (%s) %s SELECT %s FROM public.restore_staging_rows s,
         LATERAL jsonb_populate_record(NULL::public.%I, s.row_data) r
        WHERE s.restore_run_id = $1 AND s.table_name = $2
        ORDER BY s.row_sequence',
      _t, _collist,
      CASE WHEN coalesce(_ident, false) THEN 'OVERRIDING SYSTEM VALUE' ELSE '' END,
      _sellist, _t)
      USING _run_id, _t;
    GET DIAGNOSTICS _inserted = ROW_COUNT;

    IF _inserted <> coalesce((_run.expected_rows->>_t)::bigint, -1) THEN
      RAISE EXCEPTION 'RESTORE_APPLY_ROW_COUNT_MISMATCH: table=% inserted=% expected=%',
        _t, _inserted, coalesce(_run.expected_rows->>_t, 'NULL');
    END IF;
  END LOOP;

  -- 5-8) 사후 검산: 운영 == 준비 영역 (행수 + 정규화 지문)
  FOREACH _t IN ARRAY _insert_order LOOP
    _stg := public.restore_row_digest(_run_id, _t, 'staging');
    _live := public.restore_row_digest(_run_id, _t, 'live');
    IF (_stg->>'rows') <> (_live->>'rows') OR (_stg->>'digest') <> (_live->>'digest') THEN
      RAISE EXCEPTION 'RESTORE_APPLY_DIGEST_MISMATCH: table=% staging_rows=% live_rows=%',
        _t, _stg->>'rows', _live->>'rows';
    END IF;
    _per := _per || jsonb_build_array(jsonb_build_object(
      'table', _t, 'rows', (_live->>'rows')::bigint, 'digest', _live->>'digest'));
  END LOOP;

  -- 5-9) 범위 밖 권한·사용자 표 불변 확인
  FOREACH _g IN ARRAY _guard LOOP
    _guard_after := _guard_after || jsonb_build_object(_g, public.restore_row_digest(_run_id, _g, 'live')->>'digest');
    IF (_guard_after->>_g) IS DISTINCT FROM (_guard_before->>_g) THEN
      RAISE EXCEPTION 'RESTORE_OUT_OF_SCOPE_TABLE_CHANGED: %', _g;
    END IF;
  END LOOP;

  -- 5-10) sequence 재조정 (identity/serial 소유 시퀀스만)
  FOREACH _t IN ARRAY _insert_order LOOP
    FOR _c IN
      SELECT a.attname
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type ty ON ty.oid = a.atttypid
       WHERE n.nspname = 'public' AND c.relname = _t
         AND a.attnum > 0 AND NOT a.attisdropped
         AND ty.typname IN ('int2', 'int4', 'int8')
    LOOP
      _seq := pg_get_serial_sequence('public.' || quote_ident(_t), _c.attname);
      IF _seq IS NOT NULL THEN
        EXECUTE format(
          'SELECT setval(%L, coalesce((SELECT max(%I) FROM public.%I), 0) + 1, false)',
          _seq, _c.attname, _t);
        _seqs := _seqs || jsonb_build_array(jsonb_build_object('table', _t, 'column', _c.attname, 'sequence', _seq));
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.restore_runs
     SET status = 'success',
         finished_at = now(),
         updated_at = now(),
         error_code = NULL,
         error_message = NULL,
         apply_result = jsonb_build_object(
           'tables', _per,
           'sequences', _seqs,
           'guard_tables', to_jsonb(_guard),
           'overall_digest', _run.staging_overall_digest,
           'applied_at', now()
         )
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', _run_id,
    'tables', _per,
    'sequences', _seqs,
    'guard_tables', to_jsonb(_guard),
    'overall_digest', _run.staging_overall_digest
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_apply_atomic(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_apply_atomic(uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_apply_atomic(uuid, text, uuid) TO service_role;