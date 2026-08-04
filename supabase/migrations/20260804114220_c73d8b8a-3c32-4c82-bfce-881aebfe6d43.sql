-- rcl_grants 본체를 사용자 인자형으로 분리(위임 구조). 판정 로직 복제 없음.
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

  IF v_role = 'admin' THEN
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

-- 세션용 래퍼 — 위임만 한다.
CREATE OR REPLACE FUNCTION public.rcl_grants(_module text, _action text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT public.rcl_grants_impl(auth.uid(), _module, _action) $function$;

-- 조회 전용 오버로드(admin 전용). 쓰기 없음, 판정 위임.
CREATE OR REPLACE FUNCTION public.rcl_grants_for(_user_id uuid, _module text, _action text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.rcl_highest_role(auth.uid()) IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'rcl_grants_for: admin 전용 조회 함수입니다.';
  END IF;
  RETURN public.rcl_grants_impl(_user_id, _module, _action);
END $function$;

REVOKE ALL ON FUNCTION public.rcl_grants_impl(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rcl_grants(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rcl_grants_for(uuid, text, text) TO authenticated;