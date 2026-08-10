-- ============ permission helper ============
CREATE OR REPLACE FUNCTION public.spl_ocs_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR (
      SELECT COALESCE((g->>'own')::boolean,false)
          OR COALESCE((g->>'own_team')::boolean,false)
          OR COALESCE((g->>'other_team')::boolean,false)
      FROM public.rcl_grants_impl(auth.uid(), 'SPL', 'import') g
    )
  )
$$;

-- ============ 4.1 RSP ============
CREATE TABLE public.spl_rsp_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spl_item_id uuid NOT NULL REFERENCES public.spl_items(id) ON DELETE RESTRICT,
  rsp_number text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  description text,
  manufacturer text,
  model_or_unique_id text,
  unit text,
  qty_required numeric,
  qty_available numeric,
  qty_short numeric,
  source_sheet text,
  source_row int,
  source_hash text,
  source_identity text,
  is_active boolean NOT NULL DEFAULT true,
  inactive_reason text,
  inactive_at timestamptz,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spl_item_id, rsp_number)
);
CREATE UNIQUE INDEX spl_rsp_items_source_identity_uq ON public.spl_rsp_items (spl_item_id, source_identity) WHERE source_identity IS NOT NULL;
CREATE INDEX spl_rsp_items_item_idx ON public.spl_rsp_items (spl_item_id, sort_order);

-- ============ 4.2 OCS ============
CREATE TABLE public.spl_ocs_comment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_group_identity text NOT NULL UNIQUE,
  ocs_number text,
  revision text,
  source_file_name text,
  source_sheet text,
  source_row int,
  source_hash text,
  raw_comment_text text,
  is_active boolean NOT NULL DEFAULT true,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.spl_ocs_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_comment_id text NOT NULL UNIQUE,
  group_id uuid REFERENCES public.spl_ocs_comment_groups(id) ON DELETE RESTRICT,
  ocs_number text,
  revision text,
  atomic_item_no int,
  atomic_item_count int,
  comment_text text,
  contractor_response text,
  assessed_code text,
  sign_off_status text,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_reason text,
  response_mapping_status text,
  is_active boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.spl_ocs_comments(id),
  superseded_at timestamptz,
  source_sheet text,
  source_row int,
  source_hash text,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spl_ocs_comments_group_idx ON public.spl_ocs_comments (group_id);
CREATE INDEX spl_ocs_comments_active_idx ON public.spl_ocs_comments (is_active, is_resolved);

CREATE TABLE public.spl_ocs_comment_spl_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  spl_item_id uuid NOT NULL REFERENCES public.spl_items(id) ON DELETE RESTRICT,
  mapping_method text,
  confidence numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, spl_item_id)
);
CREATE INDEX spl_ocs_comment_spl_links_item_idx ON public.spl_ocs_comment_spl_links (spl_item_id);

CREATE TABLE public.spl_ocs_compliance (
  comment_id uuid PRIMARY KEY REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  complied boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'import_resolved',
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_ocs_compliance_source_chk CHECK (source IN ('import_resolved','user'))
);

CREATE TABLE public.spl_ocs_compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  old_value boolean,
  new_value boolean,
  source text NOT NULL,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spl_ocs_compliance_log_comment_idx ON public.spl_ocs_compliance_log (comment_id, changed_at DESC);

-- ============ 4.3 OCS <-> RSP ============
CREATE TABLE public.spl_ocs_comment_rsp_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  rsp_item_id uuid NOT NULL REFERENCES public.spl_rsp_items(id) ON DELETE RESTRICT,
  scope text NOT NULL DEFAULT 'single',
  mapping_method text,
  confidence numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, rsp_item_id),
  CONSTRAINT spl_ocs_comment_rsp_links_scope_chk CHECK (scope IN ('single','multiple','group','review'))
);

-- ============ 4.4 Categories ============
CREATE TABLE public.spl_ocs_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL UNIQUE,
  description text,
  color text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_user_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.spl_ocs_categories_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.spl_ocs_categories(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'initial_classifier',
  confidence numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, category_id),
  CONSTRAINT spl_ocs_categories_mapping_source_chk CHECK (source IN ('initial_classifier','user'))
);

-- ============ 4.5 attachments / sources / documents ============
CREATE TABLE public.spl_ocs_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_attachment_identity text NOT NULL UNIQUE,
  storage_path text NOT NULL UNIQUE,
  content_hash text,
  byte_size bigint,
  width int,
  height int,
  format text,
  source_file_name text,
  source_sheet text,
  source_anchor text,
  is_active boolean NOT NULL DEFAULT true,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.spl_ocs_attachment_comment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES public.spl_ocs_attachments(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  mapping_method text,
  scope text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, comment_id)
);

CREATE TABLE public.spl_ocs_source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_identity text NOT NULL UNIQUE,
  file_name text NOT NULL,
  ocs_number text,
  revision text,
  storage_path text NOT NULL UNIQUE,
  content_hash text,
  byte_size bigint,
  is_active boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.spl_ocs_source_files(id),
  superseded_at timestamptz,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.spl_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_identity text NOT NULL UNIQUE,
  file_name text NOT NULL,
  filename_document_number text,
  internal_document_number text,
  document_number text,
  revision text,
  title text,
  storage_path text NOT NULL UNIQUE,
  content_hash text,
  byte_size bigint,
  page_count int,
  number_mismatch boolean NOT NULL DEFAULT false,
  mismatch_warning text,
  review_note text,
  is_active boolean NOT NULL DEFAULT true,
  import_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.spl_document_item_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.spl_documents(id) ON DELETE CASCADE,
  spl_item_id uuid NOT NULL REFERENCES public.spl_items(id) ON DELETE RESTRICT,
  page_hint int,
  mapping_method text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, spl_item_id)
);
CREATE INDEX spl_document_item_links_item_idx ON public.spl_document_item_links (spl_item_id);

CREATE TABLE public.spl_ocs_comment_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.spl_ocs_comments(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.spl_documents(id) ON DELETE RESTRICT,
  page_number int,
  mapping_method text,
  confidence numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, document_id, page_number)
);

-- ============ 4.6 import logs ============
CREATE TABLE public.spl_ocs_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_hash text,
  file_name text,
  status text NOT NULL DEFAULT 'running',
  stage text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  imported_by uuid,
  imported_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_ocs_import_logs_status_chk CHECK (status IN ('running','success','confirmed_rollback','verification_pending','partial_or_post_verify_failure','unknown','failed','partial'))
);
CREATE UNIQUE INDEX spl_ocs_import_logs_pkg_uq ON public.spl_ocs_import_logs (package_hash) WHERE package_hash IS NOT NULL AND status IN ('success','partial','verification_pending','partial_or_post_verify_failure');

-- ============ spl_items cache columns ============
ALTER TABLE public.spl_items
  ADD COLUMN IF NOT EXISTS ocs_total int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocs_pending int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocs_complied int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocs_check int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rsp_total int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_total int NOT NULL DEFAULT 0;

-- ============ GRANTS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_rsp_items, public.spl_ocs_comment_groups, public.spl_ocs_comments,
  public.spl_ocs_comment_spl_links, public.spl_ocs_compliance, public.spl_ocs_compliance_log,
  public.spl_ocs_comment_rsp_links, public.spl_ocs_categories, public.spl_ocs_categories_mapping,
  public.spl_ocs_attachments, public.spl_ocs_attachment_comment_links, public.spl_ocs_source_files,
  public.spl_documents, public.spl_document_item_links, public.spl_ocs_comment_document_links,
  public.spl_ocs_import_logs TO authenticated;
GRANT ALL ON public.spl_rsp_items, public.spl_ocs_comment_groups, public.spl_ocs_comments,
  public.spl_ocs_comment_spl_links, public.spl_ocs_compliance, public.spl_ocs_compliance_log,
  public.spl_ocs_comment_rsp_links, public.spl_ocs_categories, public.spl_ocs_categories_mapping,
  public.spl_ocs_attachments, public.spl_ocs_attachment_comment_links, public.spl_ocs_source_files,
  public.spl_documents, public.spl_document_item_links, public.spl_ocs_comment_document_links,
  public.spl_ocs_import_logs TO service_role;

-- ============ RLS ============
ALTER TABLE public.spl_rsp_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_comment_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_comment_spl_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_compliance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_comment_rsp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_categories_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_attachment_comment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_source_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_document_item_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_comment_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spl_ocs_import_logs ENABLE ROW LEVEL SECURITY;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spl_rsp_items','spl_ocs_comment_groups','spl_ocs_comments','spl_ocs_comment_spl_links',
    'spl_ocs_compliance_log','spl_ocs_comment_rsp_links','spl_ocs_categories','spl_ocs_categories_mapping',
    'spl_ocs_attachments','spl_ocs_attachment_comment_links','spl_ocs_source_files','spl_documents',
    'spl_document_item_links','spl_ocs_comment_document_links','spl_ocs_import_logs']
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.spl_ocs_can_manage())', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.spl_ocs_can_manage()) WITH CHECK (public.spl_ocs_can_manage())', t||'_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.spl_ocs_can_manage())', t||'_delete', t);
  END LOOP;
END $do$;

CREATE POLICY spl_ocs_compliance_select ON public.spl_ocs_compliance FOR SELECT TO authenticated USING (true);
CREATE POLICY spl_ocs_compliance_write ON public.spl_ocs_compliance FOR ALL TO authenticated
  USING (public.spl_ocs_can_manage() OR EXISTS (
    SELECT 1 FROM public.spl_ocs_comment_spl_links l
    WHERE l.comment_id = spl_ocs_compliance.comment_id
      AND public.rcl_can(auth.uid(), 'SPL', l.spl_item_id, 'write')))
  WITH CHECK (public.spl_ocs_can_manage() OR EXISTS (
    SELECT 1 FROM public.spl_ocs_comment_spl_links l
    WHERE l.comment_id = spl_ocs_compliance.comment_id
      AND public.rcl_can(auth.uid(), 'SPL', l.spl_item_id, 'write')));

-- ============ updated_at triggers ============
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spl_rsp_items','spl_ocs_comment_groups','spl_ocs_comments','spl_ocs_compliance',
    'spl_ocs_categories','spl_ocs_attachments','spl_ocs_source_files','spl_documents','spl_ocs_import_logs']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', 'trg_'||t||'_updated_at', t);
  END LOOP;
END $do$;

-- ============ seed categories ============
INSERT INTO public.spl_ocs_categories (code, label, sort_order) VALUES
  ('document_reference','Document / Reference',10),
  ('recommended_spare_parts','Recommended Spare Parts',20),
  ('vendor_manufacturer','Vendor / Manufacturer',30),
  ('contract_specification','Contract / Specification',40),
  ('quantity_boq','Quantity / BOQ',50),
  ('technical_scope','Technical Scope',60),
  ('resubmission_review','Resubmission / Review',70),
  ('commercial_price','Commercial / Price',80),
  ('client_consultant_coordination','Client / Consultant Coordination',90)
ON CONFLICT (code) DO NOTHING;

-- ============ recount / verify ============
CREATE OR REPLACE FUNCTION public.spl_ocs_recount_all_internal()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH agg AS (
    SELECT i.id,
      COALESCE(c.total,0) t, COALESCE(c.resolved,0) r, COALESCE(c.complied,0) cp,
      COALESCE(rs.n,0) rn, COALESCE(d.n,0) dn
    FROM public.spl_items i
    LEFT JOIN (
      SELECT l.spl_item_id,
             count(*) FILTER (WHERE cm.is_active) total,
             count(*) FILTER (WHERE cm.is_active AND cm.is_resolved) resolved,
             count(*) FILTER (WHERE cm.is_active AND COALESCE(co.complied,false)) complied
      FROM public.spl_ocs_comment_spl_links l
      JOIN public.spl_ocs_comments cm ON cm.id = l.comment_id
      LEFT JOIN public.spl_ocs_compliance co ON co.comment_id = cm.id
      GROUP BY l.spl_item_id
    ) c ON c.spl_item_id = i.id
    LEFT JOIN (SELECT spl_item_id, count(*) n FROM public.spl_rsp_items WHERE is_active GROUP BY 1) rs ON rs.spl_item_id = i.id
    LEFT JOIN (SELECT spl_item_id, count(*) n FROM public.spl_document_item_links GROUP BY 1) d ON d.spl_item_id = i.id
  )
  UPDATE public.spl_items i
     SET ocs_total = a.t, ocs_complied = a.cp,
         ocs_pending = GREATEST(a.t - a.r - a.cp, 0),
         ocs_check = a.r, rsp_total = a.rn, document_total = a.dn
    FROM agg a
   WHERE a.id = i.id
     AND (i.ocs_total, i.ocs_complied, i.ocs_pending, i.ocs_check, i.rsp_total, i.document_total)
         IS DISTINCT FROM (a.t, a.cp, GREATEST(a.t - a.r - a.cp,0), a.r, a.rn, a.dn);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('updated_rows', n, 'at', now());
END $$;

CREATE OR REPLACE FUNCTION public.spl_ocs_verify_internal()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'comments_active', (SELECT count(*) FROM public.spl_ocs_comments WHERE is_active),
    'comments_unlinked', (SELECT count(*) FROM public.spl_ocs_comments c WHERE c.is_active
       AND NOT EXISTS (SELECT 1 FROM public.spl_ocs_comment_spl_links l WHERE l.comment_id = c.id)),
    'rsp_active', (SELECT count(*) FROM public.spl_rsp_items WHERE is_active),
    'documents_active', (SELECT count(*) FROM public.spl_documents WHERE is_active),
    'attachments_unlinked', (SELECT count(*) FROM public.spl_ocs_attachments a WHERE a.is_active
       AND NOT EXISTS (SELECT 1 FROM public.spl_ocs_attachment_comment_links l WHERE l.attachment_id = a.id)),
    'duplicate_active_source_comment_id', (SELECT count(*) FROM (
       SELECT source_comment_id FROM public.spl_ocs_comments WHERE is_active GROUP BY 1 HAVING count(*)>1) x),
    'cache_mismatch', (SELECT count(*) FROM public.spl_items i
       JOIN LATERAL (
         SELECT COALESCE(count(*) FILTER (WHERE cm.is_active),0) t,
                COALESCE(count(*) FILTER (WHERE cm.is_active AND cm.is_resolved),0) r,
                COALESCE(count(*) FILTER (WHERE cm.is_active AND COALESCE(co.complied,false)),0) cp
         FROM public.spl_ocs_comment_spl_links l
         JOIN public.spl_ocs_comments cm ON cm.id = l.comment_id
         LEFT JOIN public.spl_ocs_compliance co ON co.comment_id = cm.id
         WHERE l.spl_item_id = i.id) z ON true
       WHERE (i.ocs_total, i.ocs_complied, i.ocs_check) IS DISTINCT FROM (z.t, z.cp, z.r)),
    'at', now());
$$;

CREATE OR REPLACE FUNCTION public.spl_ocs_recount_all()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.spl_ocs_can_manage() THEN
    RAISE EXCEPTION 'not authorized: SPL import permission required';
  END IF;
  RETURN public.spl_ocs_recount_all_internal();
END $$;

CREATE OR REPLACE FUNCTION public.spl_ocs_verify()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.spl_ocs_can_manage() THEN
    RAISE EXCEPTION 'not authorized: SPL import permission required';
  END IF;
  RETURN public.spl_ocs_verify_internal();
END $$;

REVOKE ALL ON FUNCTION public.spl_ocs_recount_all_internal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spl_ocs_verify_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spl_ocs_recount_all_internal() TO service_role;
GRANT EXECUTE ON FUNCTION public.spl_ocs_verify_internal() TO service_role;
REVOKE ALL ON FUNCTION public.spl_ocs_recount_all() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.spl_ocs_verify() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spl_ocs_recount_all() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spl_ocs_verify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spl_ocs_can_manage() TO authenticated, service_role;