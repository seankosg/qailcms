-- 1) 값 기반 범위 판정 (신규 행 = 파일 값, 기존 행 = DB 값)
CREATE OR REPLACE FUNCTION public.rcl_scope_of_values(_user_id uuid, _module text, _values jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public.rcl_module_config%ROWTYPE;
  v_team text; v_col text; v_nm text; v_row_team text;
BEGIN
  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_scope_of_values: 알 수 없는 모듈 %', _module; END IF;

  SELECT upper(btrim(coalesce(team,''))) INTO v_team FROM public.profiles WHERE id = _user_id;

  IF _values IS NOT NULL THEN
    FOREACH v_col IN ARRAY v_cfg.owner_cols LOOP
      v_nm := _values->>v_col;
      IF v_nm IS NOT NULL AND btrim(v_nm) <> '' THEN
        IF public.resolve_user_by_name(v_nm) = _user_id THEN RETURN 'own'; END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_cfg.owning_team IS NOT NULL AND v_team = v_cfg.owning_team THEN RETURN 'own_team'; END IF;

  IF _values IS NOT NULL THEN
    v_row_team := upper(btrim(coalesce(_values->>v_cfg.team_col,'')));
    IF v_team <> '' AND v_row_team = v_team THEN RETURN 'own_team'; END IF;
  END IF;

  RETURN 'other_team';
END $function$;

GRANT EXECUTE ON FUNCTION public.rcl_scope_of_values(uuid, text, jsonb) TO authenticated;

-- 2) 임포트 대상 행 스코프 필터. 반환: {role, total, allowed:[key…], denied:[{key,scope}…]}
CREATE OR REPLACE FUNCTION public.rcl_import_filter(_module text, _match_cols text[], _rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public.rcl_module_config%ROWTYPE;
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_valid text[];
  v_c text;
  v_join text := '';
  v_key text := '';
  v_sql text;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'rcl_import_filter: 인증이 필요합니다'; END IF;

  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_import_filter: 알 수 없는 모듈 %', _module; END IF;

  IF _match_cols IS NULL OR array_length(_match_cols, 1) IS NULL THEN
    RAISE EXCEPTION 'rcl_import_filter: _match_cols 가 필요합니다';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'rcl_import_filter: _rows 는 배열이어야 합니다';
  END IF;

  -- 허용 컬럼은 대상 테이블에서 런타임 유도 (하드코딩 금지 규칙)
  SELECT array_agg(column_name::text) INTO v_valid
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = v_cfg.table_name;

  FOREACH v_c IN ARRAY _match_cols LOOP
    IF NOT (v_c = ANY(v_valid)) THEN
      RAISE EXCEPTION 'rcl_import_filter: 알 수 없는 매칭 컬럼 %', v_c;
    END IF;
    v_join := v_join || ' AND t.' || quote_ident(v_c) || '::text IS NOT DISTINCT FROM (i.e->>' || quote_literal(v_c) || ')';
    v_key := v_key || CASE WHEN v_key = '' THEN '' ELSE ',' END
             || quote_literal(v_c) || ', i.e->>' || quote_literal(v_c);
  END LOOP;

  v_role := public.rcl_highest_role(v_uid);
  IF v_role IS NULL THEN RAISE EXCEPTION 'rcl_import_filter: 역할이 없습니다'; END IF;
  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = v_uid), false) THEN
    RAISE EXCEPTION 'rcl_import_filter: 비활성 계정입니다';
  END IF;

  v_sql := format($f$
    SELECT jsonb_build_object(
             'allowed', COALESCE(jsonb_agg(k) FILTER (WHERE ok), '[]'::jsonb),
             'denied',  COALESCE(jsonb_agg(jsonb_build_object('key', k, 'scope', sc)) FILTER (WHERE NOT ok), '[]'::jsonb),
             'total',   count(*))
      FROM (
        SELECT s.k, s.sc,
               ($4 = 'admin' OR COALESCE((SELECT p.allowed FROM public.rcl_permissions p
                  WHERE p.role = $4::public.app_role AND p.scope = s.sc AND p.action = 'import'), false)) AS ok
          FROM (
            SELECT jsonb_build_object(%s) AS k,
                   public.rcl_scope_of_values($2, $3, COALESCE(to_jsonb(t), i.e)) AS sc
              FROM (SELECT e FROM jsonb_array_elements($1) AS e) i
              LEFT JOIN public.%I t ON true %s
          ) s
      ) s2
  $f$, v_key, v_cfg.table_name, v_join);

  EXECUTE v_sql INTO v_out USING _rows, v_uid, upper(_module), v_role::text;

  RETURN jsonb_build_object('role', v_role::text) || COALESCE(v_out, '{}'::jsonb);
END $function$;

GRANT EXECUTE ON FUNCTION public.rcl_import_filter(text, text[], jsonb) TO authenticated;