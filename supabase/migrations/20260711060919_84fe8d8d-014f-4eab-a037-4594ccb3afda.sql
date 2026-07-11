
-- Create spare_part_status_history table
CREATE TABLE public.spare_part_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_ref text NOT NULL REFERENCES public.spare_parts_raw(doc_ref) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.spare_part_status_history(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('technical','supplier','internal','general')),
  message text NOT NULL,
  source text NOT NULL DEFAULT 'app_manual' CHECK (source IN ('migration','excel_import','app_manual')),
  source_file_hash text,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sp_status_history_doc_ref ON public.spare_part_status_history(doc_ref);
CREATE INDEX idx_sp_status_history_parent ON public.spare_part_status_history(parent_comment_id);
CREATE UNIQUE INDEX idx_sp_status_history_import_dedup
  ON public.spare_part_status_history(source_file_hash, doc_ref, category, md5(message))
  WHERE source_file_hash IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_status_history TO authenticated;
GRANT ALL ON public.spare_part_status_history TO service_role;

ALTER TABLE public.spare_part_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read history"
  ON public.spare_part_status_history FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert history"
  ON public.spare_part_status_history FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Author or admin can update"
  ON public.spare_part_status_history FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() OR public.is_admin_or_super(auth.uid()))
  WITH CHECK (author_user_id = auth.uid() OR public.is_admin_or_super(auth.uid()));

CREATE POLICY "Author or admin can delete"
  ON public.spare_part_status_history FOR DELETE TO authenticated
  USING (author_user_id = auth.uid() OR public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_sp_status_history_updated
  BEFORE UPDATE ON public.spare_part_status_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One-time migration: convert issue_technical / issue_supplier / issue_internal to history entries
INSERT INTO public.spare_part_status_history (doc_ref, category, message, source, created_at)
SELECT doc_ref, 'technical', TRIM(issue_technical), 'migration', COALESCE(updated_at, now())
FROM public.spare_parts_raw
WHERE NULLIF(TRIM(issue_technical), '') IS NOT NULL;

INSERT INTO public.spare_part_status_history (doc_ref, category, message, source, created_at)
SELECT doc_ref, 'supplier', TRIM(issue_supplier), 'migration', COALESCE(updated_at, now())
FROM public.spare_parts_raw
WHERE NULLIF(TRIM(issue_supplier), '') IS NOT NULL;

INSERT INTO public.spare_part_status_history (doc_ref, category, message, source, created_at)
SELECT doc_ref, 'internal', TRIM(issue_internal), 'migration', COALESCE(updated_at, now())
FROM public.spare_parts_raw
WHERE NULLIF(TRIM(issue_internal), '') IS NOT NULL;
