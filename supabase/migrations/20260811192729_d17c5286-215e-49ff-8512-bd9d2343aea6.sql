-- 1) 단일 술어
CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'system_administrator'::app_role
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_system_admin(uuid) TO authenticated, service_role;

-- 2) 격자/모듈설정 쓰기 = 최상위 전용 (SELECT 정책은 손대지 않는다)
DROP POLICY IF EXISTS "rcl_permissions admin write" ON public.rcl_permissions;
CREATE POLICY "rcl_permissions sysadmin insert" ON public.rcl_permissions
  FOR INSERT TO authenticated WITH CHECK (public.is_system_admin(auth.uid()));
CREATE POLICY "rcl_permissions sysadmin update" ON public.rcl_permissions
  FOR UPDATE TO authenticated USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));
CREATE POLICY "rcl_permissions sysadmin delete" ON public.rcl_permissions
  FOR DELETE TO authenticated USING (public.is_system_admin(auth.uid()));

DROP POLICY IF EXISTS "rcl_module_config admin write" ON public.rcl_module_config;
CREATE POLICY "rcl_module_config sysadmin insert" ON public.rcl_module_config
  FOR INSERT TO authenticated WITH CHECK (public.is_system_admin(auth.uid()));
CREATE POLICY "rcl_module_config sysadmin update" ON public.rcl_module_config
  FOR UPDATE TO authenticated USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));
CREATE POLICY "rcl_module_config sysadmin delete" ON public.rcl_module_config
  FOR DELETE TO authenticated USING (public.is_system_admin(auth.uid()));

-- 3) 주관팀 변경 = 최상위 전용
CREATE OR REPLACE FUNCTION public.rcl_set_module_owning_team(_module text, _team text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _old text; _new text; _me uuid := auth.uid();
BEGIN
  IF NOT public.is_system_admin(_me) THEN
    RAISE EXCEPTION 'System Administrator 전용 기능입니다';
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
END $$;

-- 4) 잠금 이전 (맨 마지막)
CREATE OR REPLACE FUNCTION public.rcl_permissions_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'system_administrator' THEN
      RAISE EXCEPTION 'System Administrator 권한 행은 변경할 수 없습니다.';
    END IF;
    IF OLD.role = 'admin' AND NOT public.is_system_admin(auth.uid()) THEN
      RAISE EXCEPTION 'admin 역할 권한 행은 System Administrator 만 변경할 수 있습니다.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role = 'system_administrator' THEN
    RAISE EXCEPTION 'System Administrator 권한 행은 추가할 수 없습니다.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.role = 'admin' AND NOT public.is_system_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin 역할 권한 행은 System Administrator 만 변경할 수 있습니다.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.role = 'system_administrator' OR NEW.role = 'system_administrator')
       AND (NEW.allowed IS DISTINCT FROM OLD.allowed
            OR NEW.role IS DISTINCT FROM OLD.role
            OR NEW.scope IS DISTINCT FROM OLD.scope
            OR NEW.action IS DISTINCT FROM OLD.action) THEN
      RAISE EXCEPTION 'System Administrator 권한 행은 변경할 수 없습니다.';
    END IF;
    IF (OLD.role = 'admin' OR NEW.role = 'admin')
       AND (NEW.allowed IS DISTINCT FROM OLD.allowed
            OR NEW.role IS DISTINCT FROM OLD.role
            OR NEW.scope IS DISTINCT FROM OLD.scope
            OR NEW.action IS DISTINCT FROM OLD.action)
       AND NOT public.is_system_admin(auth.uid()) THEN
      RAISE EXCEPTION 'admin 역할 권한 행은 System Administrator 만 변경할 수 있습니다.';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;