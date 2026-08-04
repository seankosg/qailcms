-- 1) 판정 본체 1벌: 행/값 공통 (jsonb 입력)
CREATE OR REPLACE FUNCTION public.rcl_scope_core(_user_id uuid, _module text, _row jsonb)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_scope_core: 알 수 없는 모듈 %', _module; END IF;

  SELECT upper(btrim(coalesce(team,''))) INTO v_team FROM public.profiles WHERE id = _user_id;

  IF _row IS NOT NULL THEN
    FOREACH v_col IN ARRAY v_cfg.owner_cols LOOP
      v_nm := _row->>v_col;
      IF v_nm IS NOT NULL AND btrim(v_nm) <> '' THEN
        IF public.resolve_user_by_name(v_nm) = _user_id THEN RETURN 'own'; END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_cfg.owning_team IS NOT NULL AND v_team = v_cfg.owning_team THEN RETURN 'own_team'; END IF;

  IF _row IS NOT NULL THEN
    v_row_team := upper(btrim(coalesce(_row->>v_cfg.team_col,'')));
    IF coalesce(v_team,'') <> '' AND v_row_team = v_team THEN RETURN 'own_team'; END IF;
  END IF;

  RETURN 'other_team';
END $function$;

COMMENT ON FUNCTION public.rcl_scope_core(uuid, text, jsonb) IS
  'RCL 스코프 판정 정본(단일 본체). rcl_scope(행) 과 rcl_scope_of_values(값) 는 모두 이 함수에 위임한다. 순서: own → 주관팀 → 행 팀 → other_team.';

-- 2) 행 기준: 행을 읽어 본체에 위임
CREATE OR REPLACE FUNCTION public.rcl_scope(_user_id uuid, _module text, _row_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg public.rcl_module_config%ROWTYPE;
  v_row jsonb;
BEGIN
  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_scope: 알 수 없는 모듈 %', _module; END IF;

  IF _row_id IS NOT NULL THEN
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', v_cfg.table_name)
      INTO v_row USING _row_id;
  END IF;

  RETURN public.rcl_scope_core(_user_id, _module, v_row);
END $function$;

-- 3) 값 기준: 그대로 본체에 위임(SQL 복제 제거)
CREATE OR REPLACE FUNCTION public.rcl_scope_of_values(_user_id uuid, _module text, _values jsonb)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT public.rcl_scope_core(_user_id, _module, _values) $function$;

-- 4) admin 행 DB 제약: 항상 허용, 신규/삭제/역할변경 불가
ALTER TABLE public.rcl_permissions
  ADD CONSTRAINT rcl_permissions_admin_always_allowed
  CHECK (role <> 'admin'::public.app_role OR allowed = true);

CREATE OR REPLACE FUNCTION public.rcl_permissions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN RAISE EXCEPTION 'admin 역할 권한 행은 변경할 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role = 'admin' THEN
    RAISE EXCEPTION 'admin 역할 권한 행은 추가할 수 없습니다.';
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.role = 'admin' OR NEW.role = 'admin') THEN
    IF NEW.allowed IS DISTINCT FROM OLD.allowed
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.action IS DISTINCT FROM OLD.action THEN
      RAISE EXCEPTION 'admin 역할 권한 행은 변경할 수 없습니다.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $function$;