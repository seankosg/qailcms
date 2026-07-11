
-- ============================================================
-- 1. app_role enum 확장 (guest 추가)
-- ============================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'guest';

-- ============================================================
-- 2. user_type enum 신설
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.user_type AS ENUM ('subcontractor','hdec','pm_pd','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. profiles 컬럼 확장
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_type public.user_type NOT NULL DEFAULT 'hdec';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subcontractor_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hdec_pic_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles SET login_id = split_part(email,'@',1) WHERE login_id IS NULL;
ALTER TABLE public.profiles ALTER COLUMN login_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_id_unique ON public.profiles(login_id);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_subcontractor_unique
  ON public.profiles(subcontractor_name)
  WHERE user_type = 'subcontractor' AND subcontractor_name IS NOT NULL;

-- 기존 사용자는 초기 비밀번호 변경 강제에서 제외
UPDATE public.profiles SET must_change_password = false;

-- ============================================================
-- 4. Master 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subcontractor_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subcontractor_master TO authenticated;
GRANT ALL ON public.subcontractor_master TO service_role;
ALTER TABLE public.subcontractor_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read subcontractor master" ON public.subcontractor_master;
DROP POLICY IF EXISTS "Admins manage subcontractor master" ON public.subcontractor_master;
CREATE POLICY "Anyone can read subcontractor master" ON public.subcontractor_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage subcontractor master" ON public.subcontractor_master
  FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TABLE IF NOT EXISTS public.hdec_pic_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hdec_pic_master TO authenticated;
GRANT ALL ON public.hdec_pic_master TO service_role;
ALTER TABLE public.hdec_pic_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read hdec pic master" ON public.hdec_pic_master;
DROP POLICY IF EXISTS "Admins manage hdec pic master" ON public.hdec_pic_master;
CREATE POLICY "Anyone can read hdec pic master" ON public.hdec_pic_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage hdec pic master" ON public.hdec_pic_master
  FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

-- ============================================================
-- 5. 헬퍼 함수 (has_any_role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

-- login_id → email 해석 (익명 로그인 게이트웨이용)
CREATE OR REPLACE FUNCTION public.resolve_login_email(_login_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM public.profiles WHERE login_id = _login_id AND is_active = true LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

-- ============================================================
-- 6. handle_new_user 트리거 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_login_id text;
  v_user_type public.user_type;
  v_subcontractor_name text;
  v_hdec_pic_name text;
  v_must_change boolean;
  v_role public.app_role;
  v_display_name text;
  v_user_count int;
BEGIN
  v_login_id := COALESCE(NEW.raw_user_meta_data->>'login_id', split_part(NEW.email,'@',1));
  v_user_type := COALESCE((NEW.raw_user_meta_data->>'user_type')::public.user_type, 'hdec');
  v_subcontractor_name := NEW.raw_user_meta_data->>'subcontractor_name';
  v_hdec_pic_name := NEW.raw_user_meta_data->>'hdec_pic_name';
  v_must_change := COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, true);
  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', v_login_id);

  INSERT INTO public.profiles (id, email, display_name, login_id, user_type, subcontractor_name, hdec_pic_name, must_change_password)
  VALUES (NEW.id, NEW.email, v_display_name, v_login_id, v_user_type, v_subcontractor_name, v_hdec_pic_name, v_must_change);

  SELECT count(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    v_role := 'admin';
  ELSE
    v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'guest');
  END IF;

  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END $$;

-- ============================================================
-- 7. RLS 정책 재정비 (역할 기반)
--    SELECT: authenticated (guest 포함)
--    INSERT/UPDATE: user 이상
--    DELETE: admin/superuser
-- ============================================================

-- spare_parts_raw
DROP POLICY IF EXISTS "Authenticated can view spare_parts_raw" ON public.spare_parts_raw;
DROP POLICY IF EXISTS "Authenticated can insert spare_parts_raw" ON public.spare_parts_raw;
DROP POLICY IF EXISTS "Authenticated can update spare_parts_raw" ON public.spare_parts_raw;
DROP POLICY IF EXISTS "Admins can delete spare_parts_raw" ON public.spare_parts_raw;
CREATE POLICY "Authenticated can view spare_parts_raw" ON public.spare_parts_raw
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "User+ can insert spare_parts_raw" ON public.spare_parts_raw
  FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]));
CREATE POLICY "User+ can update spare_parts_raw" ON public.spare_parts_raw
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]));
CREATE POLICY "Admins can delete spare_parts_raw" ON public.spare_parts_raw
  FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- task_management_raw
DROP POLICY IF EXISTS "Authenticated can view task_management_raw" ON public.task_management_raw;
DROP POLICY IF EXISTS "Authenticated can manage task_management_raw" ON public.task_management_raw;
CREATE POLICY "Authenticated can view task_management_raw" ON public.task_management_raw
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "User+ can insert task_management_raw" ON public.task_management_raw
  FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]));
CREATE POLICY "User+ can update task_management_raw" ON public.task_management_raw
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user','superuser','admin']::public.app_role[]));
CREATE POLICY "Admins can delete task_management_raw" ON public.task_management_raw
  FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- Import logs / row logs / history / change log — SELECT all, WRITE user+
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'spare_parts_import_logs','task_management_import_logs',
    'spare_part_import_row_logs','task_management_import_row_logs',
    'spare_part_change_log','task_management_status_history',
    'spare_part_status_history','spare_part_comments','spare_part_custom_fields',
    'spare_parts_sync_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read %1$s" ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "User+ write %1$s" ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins delete %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Authenticated read %1$s" ON public.%1$s FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "User+ write %1$s" ON public.%1$s FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''user'',''superuser'',''admin'']::public.app_role[]))', t);
    EXECUTE format('CREATE POLICY "User+ update %1$s" ON public.%1$s FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''user'',''superuser'',''admin'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''user'',''superuser'',''admin'']::public.app_role[]))', t);
    EXECUTE format('CREATE POLICY "Admins delete %1$s" ON public.%1$s FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()))', t);
  END LOOP;
END $$;

-- Admin-only 관리 테이블 (mapping/config/thresholds)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'spare_part_field_config','spare_part_header_mappings','spare_part_status_mapping',
    'task_management_field_config','task_management_header_mappings','task_management_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read %1$s" ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Authenticated read %1$s" ON public.%1$s FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "Admins manage %1$s" ON public.%1$s FOR ALL TO authenticated USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()))', t);
  END LOOP;
END $$;

-- profiles: 본인 SELECT/UPDATE, admin 전체
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin_or_super(auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
