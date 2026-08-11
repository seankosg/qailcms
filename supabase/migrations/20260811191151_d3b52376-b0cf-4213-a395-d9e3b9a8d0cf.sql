-- 1) 격자 15행 추가 (행 추가만, 기존 값 수정 없음)
INSERT INTO public.rcl_permissions(role, scope, action, allowed)
SELECT 'system_administrator'::public.app_role, s.scope, a.action, true
FROM (VALUES ('own'),('own_team'),('other_team')) s(scope)
CROSS JOIN (VALUES ('read'),('write'),('delete'),('import'),('export')) a(action)
ON CONFLICT (role, scope, action) DO NOTHING;

-- 2) 서열 — ELSE 없는 CASE 라 반드시 명시
CREATE OR REPLACE FUNCTION public.rcl_highest_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'system_administrator' THEN 8
    WHEN 'admin' THEN 7 WHEN 'superuser' THEN 6 WHEN 'd_superuser' THEN 5
    WHEN 'senior_user' THEN 4 WHEN 'user' THEN 3 WHEN 'super_guest' THEN 2 WHEN 'guest' THEN 1 END DESC
  LIMIT 1
$function$;

-- 3) 판정 함수 — admin 리터럴에 최상위 추가
CREATE OR REPLACE FUNCTION public.rcl_can(_user_id uuid, _module text, _row_id uuid, _action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role public.app_role; v_scope text; v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_can: 알 수 없는 동작 %', _action;
  END IF;

  v_role := public.rcl_highest_role(_user_id);
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('admin','system_administrator') THEN RETURN true; END IF;

  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false) THEN
    RETURN false;
  END IF;

  v_scope := public.rcl_scope(_user_id, _module, _row_id);

  SELECT allowed INTO v_allowed FROM public.rcl_permissions
   WHERE role = v_role AND scope = v_scope AND action = _action;

  RETURN COALESCE(v_allowed, false);
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_can_values(_module text, _values jsonb, _action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role public.app_role; v_scope text; v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_can_values: 알 수 없는 동작 %', _action;
  END IF;
  v_role := public.rcl_highest_role(v_uid);
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('admin','system_administrator') THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = v_uid), false) THEN RETURN false; END IF;
  v_scope := public.rcl_scope_of_values(v_uid, _module, _values);
  SELECT allowed INTO v_allowed FROM public.rcl_permissions
   WHERE role = v_role AND scope = v_scope AND action = _action;
  RETURN COALESCE(v_allowed, false);
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_grants_impl(_user_id uuid, _module text, _action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
  v_cfg public.rcl_module_config%ROWTYPE;
  v_team text; v_name text; v_active boolean;
  v_own boolean := false; v_own_team boolean := false; v_other boolean := false;
BEGIN
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_grants: 알 수 없는 동작 %', _action;
  END IF;
  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_grants: 알 수 없는 모듈 %', _module; END IF;

  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('module', upper(_module), 'action', _action, 'role', NULL,
      'own', false, 'own_team', false, 'other_team', false);
  END IF;

  v_role := public.rcl_highest_role(_user_id);
  SELECT upper(trim(coalesce(team,''))), name, coalesce(is_active,false)
    INTO v_team, v_name, v_active
    FROM public.profiles WHERE id = _user_id;

  IF v_role IN ('admin','system_administrator') THEN
    v_own := true; v_own_team := true; v_other := true;
  ELSIF v_role IS NOT NULL AND v_active THEN
    SELECT coalesce(bool_or(allowed) FILTER (WHERE scope='own'), false),
           coalesce(bool_or(allowed) FILTER (WHERE scope='own_team'), false),
           coalesce(bool_or(allowed) FILTER (WHERE scope='other_team'), false)
      INTO v_own, v_own_team, v_other
      FROM public.rcl_permissions
     WHERE role = v_role AND action = _action;
  END IF;

  RETURN jsonb_build_object(
    'module', upper(_module), 'action', _action, 'role', v_role,
    'own', coalesce(v_own,false), 'own_team', coalesce(v_own_team,false),
    'other_team', coalesce(v_other,false),
    'owner_cols', to_jsonb(v_cfg.owner_cols), 'team_col', v_cfg.team_col,
    'owning_team', v_cfg.owning_team, 'my_team', v_team, 'my_name', v_name
  );
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_max_scope(_user_id uuid, _module text, _action text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role public.app_role;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  v_role := public.rcl_highest_role(_user_id);
  IF v_role IS NULL THEN RETURN NULL; END IF;
  IF v_role IN ('admin','system_administrator') THEN RETURN 'other_team'; END IF;
  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false) THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.rcl_permissions WHERE role=v_role AND scope='other_team' AND action=_action AND allowed) THEN
    RETURN 'other_team';
  END IF;
  -- 주관팀 사용자는 own_team 이 모듈 전체를 의미한다
  IF EXISTS (SELECT 1 FROM public.rcl_permissions WHERE role=v_role AND scope='own_team' AND action=_action AND allowed) THEN
    RETURN 'own_team';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rcl_permissions WHERE role=v_role AND scope='own' AND action=_action AND allowed) THEN
    RETURN 'own';
  END IF;
  RETURN NULL;
END $function$;

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
               ($4 IN ('admin','system_administrator') OR COALESCE((SELECT p.allowed FROM public.rcl_permissions p
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

-- 4) 그 외 admin 리터럴 게이트 확장
CREATE OR REPLACE FUNCTION public.rcl_grants_for(_user_id uuid, _module text, _action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.rcl_highest_role(auth.uid()) NOT IN ('admin'::public.app_role, 'system_administrator'::public.app_role) THEN
    RAISE EXCEPTION 'rcl_grants_for: admin 전용 조회 함수입니다.';
  END IF;
  RETURN public.rcl_grants_impl(_user_id, _module, _action);
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_set_module_owning_team(_module text, _team text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _old text; _new text; _me uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(_me, 'admin') OR public.has_role(_me, 'system_administrator')) THEN
    RAISE EXCEPTION 'admin 전용 기능입니다';
  END IF;
  _new := NULLIF(btrim(COALESCE(_team,'')), '');
  IF _new IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.team_master t WHERE t.name = _new) THEN
    RAISE EXCEPTION '팀 마스터에 없는 팀입니다: %', _new;
  END IF;
  SELECT owning_team INTO _old FROM public.rcl_module_config WHERE module = _module;
  IF NOT FOUND THEN RAISE EXCEPTION '모듈을 찾을 수 없습니다: %', _module; END IF;
  UPDATE public.rcl_module_config SET owning_team = _new, updated_at = now() WHERE module = _module;
  INSERT INTO public.rcl_module_config_audit(module, old_team, new_team, changed_by, changed_by_name)
  VALUES (_module, _old, _new, _me, (SELECT name FROM public.profiles WHERE id = _me));
  RETURN jsonb_build_object('module', _module, 'old_team', _old, 'new_team', _new);
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_bulk_role_preview(_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _out jsonb; _me uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(_me, 'admin') OR public.has_role(_me, 'system_administrator')) THEN
    RAISE EXCEPTION 'admin 전용 기능입니다';
  END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'line')::int) INTO _out FROM (
    SELECT jsonb_build_object(
      'line', (it->>'line')::int,
      'name', it->>'name',
      'role', it->>'role',
      'user_id', uid,
      'current_role', CASE WHEN uid IS NULL THEN NULL ELSE public.rcl_highest_role(uid)::text END,
      'match_count', mc,
      'class', CASE
        WHEN (it->>'role') IS NULL OR (it->>'role') = '' THEN 'invalid_role'
        WHEN NOT ((it->>'role') = ANY (ARRAY['admin','superuser','d_superuser','senior_user','user','super_guest','guest'])) THEN 'invalid_role'
        WHEN mc = 0 THEN 'not_found'
        WHEN mc > 1 THEN 'duplicate'
        WHEN public.rcl_highest_role(uid)::text = (it->>'role') THEN 'unchanged'
        ELSE 'change' END
    ) AS x
    FROM jsonb_array_elements(_items) it
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS mc FROM public.profiles p
       WHERE p.name_norm = public.hdec_name_norm(it->>'name')
    ) c
    CROSS JOIN LATERAL (SELECT public.resolve_user_by_name(it->>'name') AS uid) r
  ) s;
  RETURN COALESCE(_out, '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.rcl_bulk_role_apply(_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _rank jsonb := '{"system_administrator":110,"admin":100,"superuser":90,"d_superuser":80,"senior_user":70,"user":50,"super_guest":30,"guest":10}'::jsonb;
  _pv jsonb; _row jsonb; _applied int := 0; _admins int;
BEGIN
  IF NOT (public.has_role(_me, 'admin') OR public.has_role(_me, 'system_administrator')) THEN
    RAISE EXCEPTION 'admin 전용 기능입니다';
  END IF;
  _pv := public.rcl_bulk_role_preview(_items);

  -- 부분 반영 금지: 못찾음·중복·잘못된 등급이 하나라도 있으면 전체 거부
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_pv) e
              WHERE e->>'class' IN ('not_found','duplicate','invalid_role')) THEN
    RAISE EXCEPTION '미해결 항목이 있어 실행할 수 없습니다 (못찾음 · 중복 · 잘못된 등급)';
  END IF;

  FOR _row IN SELECT e FROM jsonb_array_elements(_pv) e WHERE e->>'class' = 'change'
  LOOP
    -- 본인 하향 거부
    IF (_row->>'user_id')::uuid = _me
       AND (_rank->>(_row->>'role'))::int < (_rank->>(_row->>'current_role'))::int THEN
      RAISE EXCEPTION '본인 계정의 등급은 낮출 수 없습니다 (%)', _row->>'name';
    END IF;
    -- 최상위 등급 계정은 이 경로로 변경하지 않는다
    IF public.has_role((_row->>'user_id')::uuid, 'system_administrator') THEN
      RAISE EXCEPTION '최상위 등급 계정은 이 경로로 변경할 수 없습니다 (%)', _row->>'name';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = (_row->>'user_id')::uuid;
    INSERT INTO public.user_roles(user_id, role)
    VALUES ((_row->>'user_id')::uuid, (_row->>'role')::app_role);
    _applied := _applied + 1;
  END LOOP;

  -- admin 0명 방지 (최상위 등급도 관리자 역할로 셈한다)
  SELECT count(*) INTO _admins FROM public.user_roles WHERE role IN ('admin','system_administrator');
  IF _admins = 0 THEN
    RAISE EXCEPTION 'Admin 이 0명이 되는 변경은 거부됩니다';
  END IF;

  RETURN jsonb_build_object('applied', _applied, 'admins_after', _admins, 'preview', _pv);
END $function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'superuser')
      OR public.has_role(_user_id, 'system_administrator')
$function$;

CREATE OR REPLACE FUNCTION public.is_full_access(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('system_administrator','admin','superuser','d_superuser')
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_qaqc_readonly(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND upper(trim(coalesce(p.team, ''))) = 'QAQC'
      AND p.user_type IN ('hdec_pic', 'hdec_eng')
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role IN ('admin', 'superuser', 'system_administrator')
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_edit_row(_user_id uuid, _table_name text, _row_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_module text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _table_name !~ '^[a-z_]+$' THEN RETURN false; END IF;

  v_module := public.rcl_module_of_table(_table_name);
  IF v_module IS NULL THEN
    RETURN public.rcl_highest_role(_user_id) IN ('system_administrator','admin','superuser');
  END IF;

  RETURN public.rcl_can(_user_id, v_module, _row_id, 'write');
END $function$;

CREATE OR REPLACE FUNCTION public.can_view_row(_user_id uuid, _table_name text, _row_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_module text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _table_name !~ '^[a-z_]+$' THEN RETURN false; END IF;

  v_module := public.rcl_module_of_table(_table_name);
  IF v_module IS NULL THEN
    RETURN public.rcl_highest_role(_user_id) IN ('system_administrator','admin','superuser','senior_user','user','super_guest');
  END IF;

  RETURN public.rcl_can(_user_id, v_module, _row_id, 'read');
END $function$;

CREATE OR REPLACE FUNCTION public.hdec_assert_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','superuser','system_administrator']::app_role[]) THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.abd_ocs_can_manage(_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.has_role(_uid, 'admin'), false)
      or coalesce(public.has_role(_uid, 'system_administrator'), false)
      or exists (
        select 1 from public.profiles p
        where p.id = _uid and p.user_type = 'hdec_pic' and p.team = 'DESN'
      )
$function$;

CREATE OR REPLACE FUNCTION public.spl_ocs_can_manage()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'system_administrator')
    OR (
      SELECT COALESCE((g->>'own')::boolean,false)
          OR COALESCE((g->>'own_team')::boolean,false)
          OR COALESCE((g->>'other_team')::boolean,false)
      FROM public.rcl_grants_impl(auth.uid(), 'SPL', 'import') g
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.tm_guard_milestone_admin_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NEW.milestone IS NOT DISTINCT FROM OLD.milestone THEN
    RETURN NEW;
  END IF;
  -- 서버 내부 작업(서비스 롤, 세션 없음)은 자체 코드 경로에서 별도 판정한다.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(uid, 'admin'::public.app_role)
     OR public.has_role(uid, 'system_administrator'::public.app_role) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '권한 없음: Milestone 은 현재 관리자만 변경할 수 있습니다(임시 조치).';
END;
$function$;