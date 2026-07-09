-- ============================================================
-- 0. 공용 유틸: updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. 롤 시스템 (권한 상승 방지 패턴)
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'superuser', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'superuser')
$$;

CREATE POLICY "Admin can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admin can insert roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admin can delete roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- ============================================================
-- 2. profiles (기본 사용자 프로필)
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 신규 사용자 가입 시 자동 profile 생성 + 첫 사용자는 admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. spare_parts_raw (46 표준 필드 + JSONB)
-- ============================================================
CREATE TABLE public.spare_parts_raw (
  doc_ref TEXT PRIMARY KEY,

  -- Identity / Item (A~E)
  plot TEXT NOT NULL CHECK (plot IN ('C','D')),
  category TEXT,
  subject TEXT,
  system_type TEXT,

  -- Approval (H~K)
  approval_code TEXT,
  approval_status TEXT,
  revision TEXT,
  is_duplicate BOOLEAN DEFAULT FALSE,

  -- Requirements (L~N)
  req_qty NUMERIC,
  req_unit TEXT,
  req_notes TEXT,

  -- Physical / Docs (O~T)
  physical_supply BOOLEAN,
  spec_available BOOLEAN,
  drawing_available BOOLEAN,
  manual_available BOOLEAN,
  cert_available BOOLEAN,
  warranty_available BOOLEAN,

  -- Issues / Cost (V~AB)
  issue_flag TEXT,
  issue_action TEXT,
  issue_owner TEXT,
  cost_usd NUMERIC,
  cost_qar NUMERIC,
  cost_note TEXT,
  cost_impact TEXT,

  -- Procurement (AC~AP)
  phy BOOLEAN,
  supplier TEXT,
  manufacturer TEXT,
  po_number TEXT,
  po_date DATE,
  spl_list_approved BOOLEAN,
  spl_approval_date DATE,
  qty_total NUMERIC,
  qty_delivered NUMERIC,
  delivery_status TEXT,
  delivery_date DATE,
  proc_remarks TEXT,

  -- Stage progress (AJ~AT)
  stage1_done BOOLEAN,
  stage1_date DATE,
  stage2_progress NUMERIC,
  stage2_done BOOLEAN,
  stage2_date DATE,
  stage3_progress NUMERIC,
  stage3_done BOOLEAN,
  stage3_date DATE,
  stage4_progress NUMERIC,
  stage4_done BOOLEAN,
  stage4_date DATE,

  -- 사용자 편집 필드
  remarks TEXT,
  action TEXT,

  -- JSONB 확장
  raw_payload JSONB DEFAULT '{}'::jsonb,
  custom_payload JSONB DEFAULT '{}'::jsonb,

  -- 감사
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spare_parts_plot ON public.spare_parts_raw(plot);
CREATE INDEX idx_spare_parts_approval ON public.spare_parts_raw(approval_code);
CREATE INDEX idx_spare_parts_category ON public.spare_parts_raw(category);
CREATE INDEX idx_spare_parts_supplier ON public.spare_parts_raw(supplier);
CREATE INDEX idx_spare_parts_active ON public.spare_parts_raw(is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_parts_raw TO authenticated;
GRANT ALL ON public.spare_parts_raw TO service_role;
ALTER TABLE public.spare_parts_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view spare parts"
  ON public.spare_parts_raw FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert spare parts"
  ON public.spare_parts_raw FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can update spare parts"
  ON public.spare_parts_raw FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can delete spare parts"
  ON public.spare_parts_raw FOR DELETE
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_spare_parts_updated_at
  BEFORE UPDATE ON public.spare_parts_raw
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. spare_parts_import_logs
-- ============================================================
CREATE TABLE public.spare_parts_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL DEFAULT 'spare_part',
  source_type TEXT NOT NULL DEFAULT 'spare_part_raw',  -- 'spare_part_raw' | 'aconex_sync'
  file_name TEXT NOT NULL,
  file_hash TEXT,
  file_size INTEGER,
  sheet_name TEXT,
  header_row INTEGER,
  header_map JSONB DEFAULT '{}'::jsonb,
  unknown_headers TEXT[],
  excluded_headers TEXT[],
  row_counts JSONB DEFAULT '{}'::jsonb,        -- {parsed, inserted, updated, skipped, rejected}
  warnings JSONB DEFAULT '[]'::jsonb,
  validation JSONB DEFAULT '{}'::jsonb,
  data_date DATE,
  status TEXT NOT NULL DEFAULT 'success',       -- success | failed | partial
  error_message TEXT,
  duration_ms INTEGER,
  executed_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spare_import_logs_executed_at ON public.spare_parts_import_logs(executed_at DESC);
CREATE INDEX idx_spare_import_logs_source ON public.spare_parts_import_logs(source_type);

GRANT SELECT, INSERT ON public.spare_parts_import_logs TO authenticated;
GRANT ALL ON public.spare_parts_import_logs TO service_role;
ALTER TABLE public.spare_parts_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view import logs"
  ON public.spare_parts_import_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert import logs"
  ON public.spare_parts_import_logs FOR INSERT
  TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can delete import logs"
  ON public.spare_parts_import_logs FOR DELETE
  TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- ============================================================
-- 5. spare_part_header_mappings
-- ============================================================
CREATE TABLE public.spare_part_header_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL DEFAULT 'spare_part',
  source_header TEXT NOT NULL,
  target_field TEXT NOT NULL,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, source_header)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_header_mappings TO authenticated;
GRANT ALL ON public.spare_part_header_mappings TO service_role;
ALTER TABLE public.spare_part_header_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view header mappings"
  ON public.spare_part_header_mappings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage header mappings"
  ON public.spare_part_header_mappings FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_header_mappings_updated_at
  BEFORE UPDATE ON public.spare_part_header_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 6. spare_part_custom_fields
-- ============================================================
CREATE TABLE public.spare_part_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL DEFAULT 'spare_part',
  field_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'text',       -- text | number | date | boolean
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, field_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_custom_fields TO authenticated;
GRANT ALL ON public.spare_part_custom_fields TO service_role;
ALTER TABLE public.spare_part_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view custom fields"
  ON public.spare_part_custom_fields FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage custom fields"
  ON public.spare_part_custom_fields FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_custom_fields_updated_at
  BEFORE UPDATE ON public.spare_part_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 7. spare_part_status_mapping (Aconex)
-- ============================================================
CREATE TABLE public.spare_part_status_mapping (
  source_status_raw TEXT PRIMARY KEY,
  approval_code TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_status_mapping TO authenticated;
GRANT ALL ON public.spare_part_status_mapping TO service_role;
ALTER TABLE public.spare_part_status_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view status mapping"
  ON public.spare_part_status_mapping FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage status mapping"
  ON public.spare_part_status_mapping FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_status_mapping_updated_at
  BEFORE UPDATE ON public.spare_part_status_mapping
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.spare_part_status_mapping (source_status_raw, approval_code, approval_status) VALUES
  ('A - Approved', 'A', 'APPROVED'),
  ('B - Approved with Comments', 'B', 'APPROVED WITH COMMENTS'),
  ('C - Revise and Resubmit', 'C', 'REVISE AND RESUBMIT'),
  ('D - Rejected', 'D', 'REJECTED'),
  ('For Review', 'UR', 'UNDER REVIEW');

-- ============================================================
-- 8. spare_parts_sync_log (Aconex)
-- ============================================================
CREATE TABLE public.spare_parts_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_hash TEXT,
  generated_on TIMESTAMPTZ,
  plots TEXT[],
  matched INTEGER DEFAULT 0,
  changed INTEGER DEFAULT 0,
  unchanged INTEGER DEFAULT 0,
  dp_held INTEGER DEFAULT 0,
  unmatched_export INTEGER DEFAULT 0,
  db_uncovered INTEGER DEFAULT 0,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  changes_detail JSONB DEFAULT '[]'::jsonb,
  executed_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_log_executed_at ON public.spare_parts_sync_log(executed_at DESC);

GRANT SELECT, INSERT ON public.spare_parts_sync_log TO authenticated;
GRANT ALL ON public.spare_parts_sync_log TO service_role;
ALTER TABLE public.spare_parts_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view sync logs"
  ON public.spare_parts_sync_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert sync logs"
  ON public.spare_parts_sync_log FOR INSERT
  TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));

-- ============================================================
-- 9. spare_part_comments
-- ============================================================
CREATE TABLE public.spare_part_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_ref TEXT NOT NULL REFERENCES public.spare_parts_raw(doc_ref) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spare_comments_doc_ref ON public.spare_part_comments(doc_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_comments TO authenticated;
GRANT ALL ON public.spare_part_comments TO service_role;
ALTER TABLE public.spare_part_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view comments"
  ON public.spare_part_comments FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert own comments"
  ON public.spare_part_comments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can update own comments"
  ON public.spare_part_comments FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can delete own comments or admin"
  ON public.spare_part_comments FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id OR public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_spare_comments_updated_at
  BEFORE UPDATE ON public.spare_part_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
