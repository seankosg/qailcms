-- ============================================================================
-- 안전 복원 HP3 최종 교정 (엔진 보강만; 실행/UI 활성화 없음)
--  · 삭제/삽입 순서 계약 완전 검증 (LOCK/DELETE 이전)
--  · 안전 스냅샷 결속·재검증 강화
-- 금지 준수: TRUNCATE 미사용, 트리거/제약 비활성화 없음, session_replication_role 미변경,
--            PUBLIC/anon/authenticated 실행권한 부여 없음, 기존 migration 미수정.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A) 순서 계약 완전 검증 (읽기 전용)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_assert_order_contract(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _ins text[];
  _rem text[];
  _fin text[];
  _wl text[];
  _bad text;
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;

  _fin := coalesce(_run.final_restore_tables, '{}'::text[]);

  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _ins
    FROM jsonb_array_elements_text(coalesce(_run.dependency_result->'insert_order', '[]'::jsonb))
         WITH ORDINALITY AS u(v, i);
  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _rem
    FROM jsonb_array_elements_text(coalesce(_run.dependency_result->'remove_order', '[]'::jsonb))
         WITH ORDINALITY AS u(v, i);

  IF array_length(_fin, 1) IS NULL
     OR array_length(_ins, 1) IS NULL
     OR array_length(_rem, 1) IS NULL THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_MISSING';
  END IF;

  -- 1) 빈 값 금지
  IF EXISTS (SELECT 1 FROM unnest(_fin || _ins || _rem) t WHERE t IS NULL OR btrim(t) = '') THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_EMPTY_TABLE_NAME';
  END IF;

  -- 2) 중복 금지 (세 배열 각각)
  IF (SELECT count(DISTINCT t) FROM unnest(_fin) t) <> array_length(_fin, 1) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_DUPLICATE: final_restore_tables';
  END IF;
  IF (SELECT count(DISTINCT t) FROM unnest(_ins) t) <> array_length(_ins, 1) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_DUPLICATE: insert_order';
  END IF;
  IF (SELECT count(DISTINCT t) FROM unnest(_rem) t) <> array_length(_rem, 1) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_DUPLICATE: remove_order';
  END IF;

  -- 3) 집합 동일성 (insert_order / remove_order 둘 다)
  IF NOT (_ins @> _fin AND _fin @> _ins) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_MISMATCH: insert_order';
  END IF;
  IF NOT (_rem @> _fin AND _fin @> _rem) THEN
    RAISE EXCEPTION 'RESTORE_ORDER_CONTRACT_MISMATCH: remove_order';
  END IF;

  -- 4) 백업 정본 화이트리스트
  _wl := public.get_backup_tables();
  SELECT t INTO _bad FROM unnest(_fin) t WHERE NOT (t = ANY(_wl)) LIMIT 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'RESTORE_TABLE_NOT_WHITELISTED: %', _bad;
  END IF;

  -- 5) 실제 public 일반 테이블
  SELECT t INTO _bad
    FROM unnest(_fin) t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
   )
   LIMIT 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'RESTORE_TABLE_NOT_FOUND: %', _bad;
  END IF;

  RETURN jsonb_build_object(
    'run_id', _run_id,
    'final_restore_tables', to_jsonb(_fin),
    'insert_order', to_jsonb(_ins),
    'remove_order', to_jsonb(_rem),
    'ok', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_assert_order_contract(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_assert_order_contract(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_assert_order_contract(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) 안전 스냅샷 결속 조건 검증 (결속 시 + 반영 직전 재확인 공용)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_assert_safety_snapshot(_run_id uuid, _snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
  _snap public.database_snapshots;
  _md jsonb;
  _tm jsonb;
  _missing text[];
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
  IF _snapshot_id IS NULL THEN RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_MISSING'; END IF;
  IF _snapshot_id = _run.snapshot_id THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_SAME_AS_SOURCE';
  END IF;

  SELECT * INTO _snap FROM public.database_snapshots WHERE id = _snapshot_id;
  IF _snap.id IS NULL THEN RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_NOT_FOUND'; END IF;
  IF _snap.sha256_hash IS NULL OR _snap.metadata IS NULL THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_INCOMPLETE';
  END IF;

  _md := _snap.metadata;
  IF coalesce(_md->>'schema_version', '') <> 'qail-snapshot-v2' THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED';
  END IF;

  _tm := coalesce(_md->'trigger_metadata', 'null'::jsonb);
  IF _tm IS NULL OR jsonb_typeof(_tm) <> 'object' THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_METADATA_MISSING';
  END IF;
  IF coalesce(_tm->>'kind', '') <> 'pre-safe-restore' THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_KIND_INVALID';
  END IF;
  IF coalesce(_tm->>'restore_run_id', '') <> _run_id::text THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_RUN_MISMATCH';
  END IF;

  -- 성공 로그가 같은 스냅샷을 가리켜야 한다.
  IF NOT EXISTS (
    SELECT 1 FROM public.backup_run_log
     WHERE snapshot_id = _snapshot_id AND status = 'success'
  ) THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_NOT_SUCCESSFUL';
  END IF;

  -- 잠금 유지 (보관기간 정리·삭제로부터 보호)
  IF coalesce(_snap.is_locked, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_NOT_LOCKED';
  END IF;

  -- 준비 검산 이후 생성
  IF _run.staging_verified_at IS NOT NULL AND _snap.created_at < _run.staging_verified_at THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_TOO_OLD';
  END IF;

  -- 백업 정본 표 전체 포함 (대상 표만 포함한 스냅샷은 불가)
  SELECT coalesce(array_agg(t), '{}'::text[]) INTO _missing
    FROM unnest(public.get_backup_tables()) t
   WHERE NOT (t = ANY(coalesce(_snap.tables_included, '{}'::text[])));
  IF array_length(_missing, 1) > 0 THEN
    RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_INCOMPLETE_COVERAGE: %', array_to_string(_missing, ',');
  END IF;

  RETURN jsonb_build_object('run_id', _run_id, 'safety_snapshot_id', _snapshot_id, 'ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_assert_safety_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_assert_safety_snapshot(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_assert_safety_snapshot(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) 결속 함수: 잠금 후 강화 검증 통과 시에만 결속
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_bind_safety_snapshot(_run_id uuid, _snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  _run public.restore_runs;
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
  IF _run.status <> 'staging_verified' THEN
    RAISE EXCEPTION 'RESTORE_STAGING_NOT_VERIFIED: status=%', _run.status;
  END IF;

  -- 순서 계약이 성립하지 않으면 결속 자체를 허용하지 않는다.
  PERFORM public.restore_assert_order_contract(_run_id);

  -- 잠금은 검증 대상이므로 먼저 설정한 뒤 전체 조건을 확인한다(실패 시 롤백).
  UPDATE public.database_snapshots SET is_locked = true WHERE id = _snapshot_id;
  PERFORM public.restore_assert_safety_snapshot(_run_id, _snapshot_id);

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
-- D) 반영 엔진: 순서 계약·안전 스냅샷 재검증을 LOCK/DELETE 앞에 배치
--    (그 외 본문은 기존과 동일)
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
  _contract jsonb;
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

  -- 1) 상태 원자 점유 (중복 실행 차단)
  UPDATE public.restore_runs
     SET status = 'applying', applied_by = _actor, applied_at = now(), updated_at = now()
   WHERE id = _run_id AND status = 'staging_verified'
  RETURNING * INTO _run;

  IF _run.id IS NULL THEN
    SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
    IF _run.id IS NULL THEN RAISE EXCEPTION 'RESTORE_RUN_NOT_FOUND'; END IF;
    RAISE EXCEPTION 'RESTORE_APPLY_NOT_CLAIMABLE: status=%', _run.status;
  END IF;

  -- 2) 관문: 안전 스냅샷 / 고정 지문 / 검산 결과
  IF _run.safety_snapshot_id IS NULL THEN RAISE EXCEPTION 'RESTORE_SAFETY_SNAPSHOT_MISSING'; END IF;
  IF _run.staging_overall_digest IS NULL THEN RAISE EXCEPTION 'RESTORE_STAGING_DIGEST_MISSING'; END IF;
  IF _expected_overall_digest IS NULL OR _expected_overall_digest <> _run.staging_overall_digest THEN
    RAISE EXCEPTION 'RESTORE_STAGING_DIGEST_MISMATCH';
  END IF;
  IF coalesce((_run.staging_verify->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RESTORE_STAGING_VERIFY_NOT_CLEAN';
  END IF;

  -- 2-1) 안전 스냅샷 결속 재검증 (존재·잠금·성공로그·metadata 결속)
  PERFORM public.restore_assert_safety_snapshot(_run_id, _run.safety_snapshot_id);

  -- 3) 순서 계약 완전 검증 — 동적 SQL/LOCK/DELETE 보다 앞
  _contract := public.restore_assert_order_contract(_run_id);
  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _insert_order
    FROM jsonb_array_elements_text(_contract->'insert_order') WITH ORDINALITY AS u(v, i);
  SELECT coalesce(array_agg(v ORDER BY i), '{}'::text[]) INTO _remove_order
    FROM jsonb_array_elements_text(_contract->'remove_order') WITH ORDINALITY AS u(v, i);

  _fp := public.backup_schema_fingerprint(_run.final_restore_tables);
  IF _run.schema_fingerprint IS DISTINCT FROM _fp THEN
    RAISE EXCEPTION 'RESTORE_SCHEMA_CHANGED_BEFORE_APPLY';
  END IF;

  _d := public.restore_staging_digest(_run_id);
  IF (_d->>'overall') <> _run.staging_overall_digest THEN
    RAISE EXCEPTION 'RESTORE_STAGING_CHANGED_AFTER_VERIFY';
  END IF;

  -- 4) 범위 밖 권한·사용자 표 불변 기준값
  SELECT coalesce(array_agg(t), '{}'::text[]) INTO _guard
    FROM unnest(ARRAY['profiles','user_roles','rcl_permissions','rcl_module_config']) t
   WHERE NOT (t = ANY(_run.final_restore_tables));
  FOREACH _g IN ARRAY _guard LOOP
    _guard_before := _guard_before || jsonb_build_object(_g, public.restore_row_digest(_run_id, _g, 'live')->>'digest');
  END LOOP;

  -- 5) 대상 표 잠금 (TRUNCATE 미사용, 트리거·제약 유지)
  FOREACH _t IN ARRAY _insert_order LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', _t);
  END LOOP;

  -- 6) 삭제 (자식 → 부모)
  FOREACH _t IN ARRAY _remove_order LOOP
    EXECUTE format('DELETE FROM public.%I', _t);
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    _per := _per || jsonb_build_array(jsonb_build_object('table', _t, 'deleted', _deleted));
  END LOOP;

  -- 7) 삽입 (부모 → 자식)
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

  -- 8) 사후 검산: 운영 == 준비 영역 (행수 + 정규화 지문)
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

  -- 9) 범위 밖 권한·사용자 표 불변 확인
  FOREACH _g IN ARRAY _guard LOOP
    _guard_after := _guard_after || jsonb_build_object(_g, public.restore_row_digest(_run_id, _g, 'live')->>'digest');
    IF (_guard_after->>_g) IS DISTINCT FROM (_guard_before->>_g) THEN
      RAISE EXCEPTION 'RESTORE_OUT_OF_SCOPE_TABLE_CHANGED: %', _g;
    END IF;
  END LOOP;

  -- 10) sequence 재조정 (identity/serial 소유 시퀀스만)
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