CREATE OR REPLACE FUNCTION public.rcl_grants(_module text, _action text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_cfg public.rcl_module_config%ROWTYPE;
  v_team text;
  v_name text;
  v_active boolean;
  v_own boolean := false;
  v_own_team boolean := false;
  v_other boolean := false;
BEGIN
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_grants: 알 수 없는 동작 %', _action;
  END IF;
  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_grants: 알 수 없는 모듈 %', _module; END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('module', upper(_module), 'action', _action, 'role', NULL,
      'own', false, 'own_team', false, 'other_team', false);
  END IF;

  v_role := public.rcl_highest_role(v_uid);
  SELECT upper(trim(coalesce(team,''))), name, coalesce(is_active,false)
    INTO v_team, v_name, v_active
    FROM public.profiles WHERE id = v_uid;

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
    'module', upper(_module),
    'action', _action,
    'role', v_role,
    'own', coalesce(v_own,false),
    'own_team', coalesce(v_own_team,false),
    'other_team', coalesce(v_other,false),
    'owner_cols', to_jsonb(v_cfg.owner_cols),
    'team_col', v_cfg.team_col,
    'owning_team', v_cfg.owning_team,
    'my_team', v_team,
    'my_name', v_name
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.rcl_grants(text, text) TO authenticated;