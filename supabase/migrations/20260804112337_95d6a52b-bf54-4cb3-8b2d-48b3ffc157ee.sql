CREATE OR REPLACE FUNCTION public.rcl_can_rows(_module text, _row_ids uuid[], _action text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_allowed jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('action', _action, 'allowed', '[]'::jsonb); END IF;
  IF _row_ids IS NULL OR array_length(_row_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('action', _action, 'allowed', '[]'::jsonb);
  END IF;
  IF array_length(_row_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'rcl_can_rows: 한 번에 최대 2000행까지만 판정합니다 (요청 %)', array_length(_row_ids, 1);
  END IF;
  FOREACH v_id IN ARRAY _row_ids LOOP
    IF public.rcl_can(v_uid, _module, v_id, _action) THEN
      v_allowed := v_allowed || to_jsonb(v_id::text);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('action', _action, 'total', array_length(_row_ids, 1), 'allowed', v_allowed);
END $$;

CREATE OR REPLACE FUNCTION public.rcl_can_values(_module text, _values jsonb, _action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_role public.app_role; v_scope text; v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_can_values: 알 수 없는 동작 %', _action;
  END IF;
  v_role := public.rcl_highest_role(v_uid);
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = v_uid), false) THEN RETURN false; END IF;
  v_scope := public.rcl_scope_of_values(v_uid, _module, _values);
  SELECT allowed INTO v_allowed FROM public.rcl_permissions
   WHERE role = v_role AND scope = v_scope AND action = _action;
  RETURN COALESCE(v_allowed, false);
END $$;

GRANT EXECUTE ON FUNCTION public.rcl_can_rows(text, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rcl_can_values(text, jsonb, text) TO authenticated;