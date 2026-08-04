-- ============ 1. 권한표 ============
CREATE TABLE public.rcl_permissions (
  role public.app_role NOT NULL,
  scope text NOT NULL CHECK (scope IN ('own','own_team','other_team')),
  action text NOT NULL CHECK (action IN ('read','write','delete','import','export')),
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, scope, action)
);
GRANT SELECT ON public.rcl_permissions TO authenticated;
GRANT ALL ON public.rcl_permissions TO service_role;
ALTER TABLE public.rcl_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcl_permissions read" ON public.rcl_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "rcl_permissions admin write" ON public.rcl_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ 2. 모듈 설정 ============
CREATE TABLE public.rcl_module_config (
  module text PRIMARY KEY,
  table_name text NOT NULL,
  owning_team text,
  owner_cols text[] NOT NULL,
  team_col text NOT NULL DEFAULT 'team',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rcl_module_config TO authenticated;
GRANT ALL ON public.rcl_module_config TO service_role;
ALTER TABLE public.rcl_module_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcl_module_config read" ON public.rcl_module_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "rcl_module_config admin write" ON public.rcl_module_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.rcl_module_config (module, table_name, owning_team, owner_cols) VALUES
  ('TM','task_management_raw', NULL,  ARRAY['hdec_pic_name','hdec_eng_name']),
  ('ABD','abd_items_raw',     'DESN', ARRAY['hdec_pic_name','hdec_eng_name']),
  ('SM','defect_items_raw',   'QAQC', ARRAY['hdec_pic_name','hdec_eng_name']),
  ('SPL','spl_items',         'PRJC', ARRAY['pic','eng']),
  ('WRT','wrt_items',         'PRJC', ARRAY['pic','eng']);

-- ============ 3. 이력 ============
CREATE TABLE public.rcl_permissions_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  changed_by_name text,
  role public.app_role NOT NULL,
  scope text NOT NULL,
  action text NOT NULL,
  old_allowed boolean,
  new_allowed boolean,
  op text NOT NULL
);
CREATE INDEX rcl_permissions_audit_changed_at_idx ON public.rcl_permissions_audit (changed_at DESC);
GRANT SELECT ON public.rcl_permissions_audit TO authenticated;
GRANT ALL ON public.rcl_permissions_audit TO service_role;
ALTER TABLE public.rcl_permissions_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcl_audit read" ON public.rcl_permissions_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "rcl_audit admin write" ON public.rcl_permissions_audit FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ 4. 시드 (§0 정본 표) ============
-- User: own 전부 Y, own_team/other_team 전부 N
INSERT INTO public.rcl_permissions (role, scope, action, allowed)
SELECT r.role, s.scope, a.action,
  CASE
    WHEN r.role = 'admin' THEN true
    WHEN r.role IN ('guest','super_guest') THEN (a.action = 'read')
    WHEN r.role = 'user' THEN (s.scope = 'own')
    WHEN r.role = 'senior_user' THEN
      CASE WHEN s.scope = 'own' THEN true
           WHEN s.scope = 'own_team' THEN a.action IN ('read','delete','import')
           ELSE false END
    WHEN r.role = 'd_superuser' THEN
      CASE WHEN s.scope IN ('own','own_team') THEN true
           ELSE a.action IN ('write','import','export') END
    WHEN r.role = 'superuser' THEN true
    ELSE false
  END
FROM (SELECT unnest(enum_range(NULL::public.app_role)) AS role) r
CROSS JOIN (SELECT unnest(ARRAY['own','own_team','other_team']) AS scope) s
CROSS JOIN (SELECT unnest(ARRAY['read','write','delete','import','export']) AS action) a;

-- ============ 5. 안전장치: admin 행 불변 ============
CREATE OR REPLACE FUNCTION public.rcl_permissions_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN RAISE EXCEPTION 'admin 역할 권한 행은 변경할 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.role = 'admin' AND TG_OP = 'UPDATE' AND (NEW.allowed IS DISTINCT FROM OLD.allowed) THEN
    RAISE EXCEPTION 'admin 역할 권한 행은 변경할 수 없습니다.';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rcl_permissions_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.rcl_permissions
FOR EACH ROW EXECUTE FUNCTION public.rcl_permissions_guard();

-- ============ 6. 이력 트리거 ============
CREATE OR REPLACE FUNCTION public.rcl_permissions_audit_trg_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF TG_OP = 'UPDATE' AND NEW.allowed IS NOT DISTINCT FROM OLD.allowed THEN RETURN NEW; END IF;
  INSERT INTO public.rcl_permissions_audit (changed_by, changed_by_name, role, scope, action, old_allowed, new_allowed, op)
  VALUES (auth.uid(), v_name,
          COALESCE(NEW.role, OLD.role), COALESCE(NEW.scope, OLD.scope), COALESCE(NEW.action, OLD.action),
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.allowed END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.allowed END,
          TG_OP);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER rcl_permissions_audit_trg
AFTER INSERT OR UPDATE OR DELETE ON public.rcl_permissions
FOR EACH ROW EXECUTE FUNCTION public.rcl_permissions_audit_trg_fn();

-- ============ 7. 최고 등급 ============
CREATE OR REPLACE FUNCTION public.rcl_highest_role(_user_id uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 7 WHEN 'superuser' THEN 6 WHEN 'd_superuser' THEN 5
    WHEN 'senior_user' THEN 4 WHEN 'user' THEN 3 WHEN 'super_guest' THEN 2 WHEN 'guest' THEN 1 END DESC
  LIMIT 1
$$;

-- ============ 8. 범위 판정 ============
CREATE OR REPLACE FUNCTION public.rcl_scope(_user_id uuid, _module text, _row_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.rcl_module_config%ROWTYPE;
  v_team text; v_row jsonb; v_col text; v_row_team text;
BEGIN
  SELECT * INTO v_cfg FROM public.rcl_module_config WHERE module = upper(_module);
  IF NOT FOUND THEN RAISE EXCEPTION 'rcl_scope: 알 수 없는 모듈 %', _module; END IF;

  SELECT upper(trim(coalesce(team,''))) INTO v_team FROM public.profiles WHERE id = _user_id;

  IF _row_id IS NOT NULL THEN
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', v_cfg.table_name)
      INTO v_row USING _row_id;
  END IF;

  IF v_row IS NOT NULL THEN
    FOREACH v_col IN ARRAY v_cfg.owner_cols LOOP
      IF public.resolve_user_by_name(v_row->>v_col) = _user_id THEN RETURN 'own'; END IF;
    END LOOP;
  END IF;

  -- 주관팀: 해당 모듈 전체를 own_team 으로 취급
  IF v_cfg.owning_team IS NOT NULL AND v_team = v_cfg.owning_team THEN RETURN 'own_team'; END IF;

  IF v_row IS NOT NULL THEN
    v_row_team := upper(trim(coalesce(v_row->>v_cfg.team_col,'')));
    IF v_team <> '' AND v_row_team = v_team THEN RETURN 'own_team'; END IF;
  END IF;

  RETURN 'other_team';
END $$;

-- ============ 9. 정본 판정 함수 ============
CREATE OR REPLACE FUNCTION public.rcl_can(_user_id uuid, _module text, _row_id uuid, _action text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role; v_scope text; v_allowed boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _action NOT IN ('read','write','delete','import','export') THEN
    RAISE EXCEPTION 'rcl_can: 알 수 없는 동작 %', _action;
  END IF;

  v_role := public.rcl_highest_role(_user_id);
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;

  IF NOT COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false) THEN
    RETURN false;
  END IF;

  v_scope := public.rcl_scope(_user_id, _module, _row_id);

  SELECT allowed INTO v_allowed FROM public.rcl_permissions
   WHERE role = v_role AND scope = v_scope AND action = _action;

  RETURN COALESCE(v_allowed, false);
END $$;

-- ============ 10. 최대 범위 (임포트/익스포트 드롭다운용) ============
CREATE OR REPLACE FUNCTION public.rcl_max_scope(_user_id uuid, _module text, _action text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  v_role := public.rcl_highest_role(_user_id);
  IF v_role IS NULL THEN RETURN NULL; END IF;
  IF v_role = 'admin' THEN RETURN 'other_team'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.rcl_role_counts()
RETURNS TABLE(role public.app_role, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.role, count(*)::bigint FROM public.user_roles ur GROUP BY ur.role
$$;