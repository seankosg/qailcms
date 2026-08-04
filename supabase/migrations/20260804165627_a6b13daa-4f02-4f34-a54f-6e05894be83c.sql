-- ============================================================
-- ABD OCS Stage A1 : DB 기반
-- ============================================================

CREATE OR REPLACE FUNCTION public.abd_ocs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------- 1. abd_ocs_comments ----------
CREATE TABLE public.abd_ocs_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_comment_id text NOT NULL UNIQUE,

  ocs_number text,
  ocs_number_norm text,
  source_drawing_number text,
  drawing_number_norm text,

  ocs_sn text,
  file_revision text,
  comment_revision text,
  comment_part text,

  ocs_comment text,
  assessed_code text,
  contractor_response text,
  sign_off_status text,

  source_file_name text,
  source_sheet_name text,
  source_row_index integer,
  source_row_hash text,
  source_modified_at timestamptz,
  import_log_id uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),

  abd_item_id uuid NULL REFERENCES public.abd_items_raw(id) ON DELETE SET NULL,
  link_status text NOT NULL DEFAULT 'unmatched' CHECK (link_status IN ('linked','unmatched')),
  link_method text,
  linked_at timestamptz,
  link_note text,

  is_active boolean NOT NULL DEFAULT true,
  inactive_at timestamptz,
  retired_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_abd_ocs_comments_item ON public.abd_ocs_comments(abd_item_id);
CREATE INDEX idx_abd_ocs_comments_ocs_norm ON public.abd_ocs_comments(ocs_number_norm);
CREATE INDEX idx_abd_ocs_comments_dwg_norm ON public.abd_ocs_comments(drawing_number_norm);
CREATE INDEX idx_abd_ocs_comments_link_status ON public.abd_ocs_comments(link_status);
CREATE INDEX idx_abd_ocs_comments_active ON public.abd_ocs_comments(is_active);

CREATE TRIGGER trg_abd_ocs_comments_touch
BEFORE UPDATE ON public.abd_ocs_comments
FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_comments TO authenticated;
GRANT ALL ON public.abd_ocs_comments TO service_role;
ALTER TABLE public.abd_ocs_comments ENABLE ROW LEVEL SECURITY;

-- 가시성 정본: 관리자 = 전체 / 일반 = ABD 항목에 연결된 활성 행만
CREATE OR REPLACE FUNCTION public.abd_ocs_comment_visible(_comment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.abd_ocs_comments c
    WHERE c.id = _comment_id
      AND (
        public.is_admin_or_super(auth.uid())
        OR (c.is_active AND c.abd_item_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.abd_items_raw r WHERE r.id = c.abd_item_id))
      )
  );
$$;

CREATE POLICY abd_ocs_comments_select ON public.abd_ocs_comments
FOR SELECT TO authenticated
USING (
  public.is_admin_or_super(auth.uid())
  OR (
    is_active
    AND abd_item_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.abd_items_raw r WHERE r.id = abd_ocs_comments.abd_item_id)
  )
);

CREATE POLICY abd_ocs_comments_admin_insert ON public.abd_ocs_comments
FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_comments_admin_update ON public.abd_ocs_comments
FOR UPDATE TO authenticated USING (public.is_admin_or_super(auth.uid()))
WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_comments_admin_delete ON public.abd_ocs_comments
FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- ---------- 2. abd_ocs_compliance ----------
CREATE TABLE public.abd_ocs_compliance (
  comment_id uuid PRIMARY KEY REFERENCES public.abd_ocs_comments(id) ON DELETE CASCADE,
  complied boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('import_status_a','user')),
  complied_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  complied_by_name text,
  complied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_abd_ocs_compliance_touch
BEFORE UPDATE ON public.abd_ocs_compliance
FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_compliance TO authenticated;
GRANT ALL ON public.abd_ocs_compliance TO service_role;
ALTER TABLE public.abd_ocs_compliance ENABLE ROW LEVEL SECURITY;

CREATE POLICY abd_ocs_compliance_select ON public.abd_ocs_compliance
FOR SELECT TO authenticated
USING (public.abd_ocs_comment_visible(comment_id));

CREATE POLICY abd_ocs_compliance_admin_insert ON public.abd_ocs_compliance
FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_compliance_admin_update ON public.abd_ocs_compliance
FOR UPDATE TO authenticated USING (public.is_admin_or_super(auth.uid()))
WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_compliance_admin_delete ON public.abd_ocs_compliance
FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- ---------- 3. abd_ocs_attachments ----------
CREATE TABLE public.abd_ocs_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_attachment_id text NOT NULL UNIQUE,
  comment_id uuid NOT NULL REFERENCES public.abd_ocs_comments(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  sort_order integer NOT NULL DEFAULT 0,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_abd_ocs_attachments_comment ON public.abd_ocs_attachments(comment_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_attachments TO authenticated;
GRANT ALL ON public.abd_ocs_attachments TO service_role;
ALTER TABLE public.abd_ocs_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY abd_ocs_attachments_select ON public.abd_ocs_attachments
FOR SELECT TO authenticated
USING (public.abd_ocs_comment_visible(comment_id));

CREATE POLICY abd_ocs_attachments_admin_insert ON public.abd_ocs_attachments
FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_attachments_admin_update ON public.abd_ocs_attachments
FOR UPDATE TO authenticated USING (public.is_admin_or_super(auth.uid()))
WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_attachments_admin_delete ON public.abd_ocs_attachments
FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- ---------- 4. abd_ocs_compliance_log ----------
CREATE TABLE public.abd_ocs_compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NULL REFERENCES public.abd_ocs_comments(id) ON DELETE SET NULL,
  abd_item_id uuid NULL,
  source_comment_id text NOT NULL,
  abd_number text,
  ocs_number text,
  old_complied boolean,
  new_complied boolean NOT NULL,
  source text NOT NULL,
  changed_by uuid NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_abd_ocs_compliance_log_comment ON public.abd_ocs_compliance_log(comment_id);
CREATE INDEX idx_abd_ocs_compliance_log_changed_at ON public.abd_ocs_compliance_log(changed_at DESC);

GRANT SELECT, INSERT ON public.abd_ocs_compliance_log TO authenticated;
GRANT ALL ON public.abd_ocs_compliance_log TO service_role;
ALTER TABLE public.abd_ocs_compliance_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY abd_ocs_compliance_log_admin_select ON public.abd_ocs_compliance_log
FOR SELECT TO authenticated USING (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_compliance_log_admin_insert ON public.abd_ocs_compliance_log
FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));

-- ---------- 5. abd_ocs_import_logs ----------
CREATE TABLE public.abd_ocs_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_name text,
  manifest_hash text,
  source_file_name text,
  source_file_hash text,
  status text NOT NULL DEFAULT 'running',
  total_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  inactivated_count integer NOT NULL DEFAULT 0,
  linked_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  errors jsonb,
  imported_by uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_abd_ocs_import_logs_started ON public.abd_ocs_import_logs(started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.abd_ocs_import_logs TO authenticated;
GRANT ALL ON public.abd_ocs_import_logs TO service_role;
ALTER TABLE public.abd_ocs_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY abd_ocs_import_logs_admin_select ON public.abd_ocs_import_logs
FOR SELECT TO authenticated USING (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_import_logs_admin_insert ON public.abd_ocs_import_logs
FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY abd_ocs_import_logs_admin_update ON public.abd_ocs_import_logs
FOR UPDATE TO authenticated USING (public.is_admin_or_super(auth.uid()))
WITH CHECK (public.is_admin_or_super(auth.uid()));