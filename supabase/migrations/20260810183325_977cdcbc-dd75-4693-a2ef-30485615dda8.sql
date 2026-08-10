ALTER TABLE public.spl_documents
  ADD COLUMN IF NOT EXISTS is_ocr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_engine text NULL,
  ADD COLUMN IF NOT EXISTS ocr_processed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ocr_language text NULL,
  ADD COLUMN IF NOT EXISTS ocr_text_hash text NULL;

CREATE TABLE IF NOT EXISTS public.spl_document_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.spl_documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  extracted_text text NOT NULL DEFAULT '',
  normalized_text text NOT NULL DEFAULT '',
  text_hash text NOT NULL,
  extraction_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_document_pages TO authenticated;
GRANT ALL ON public.spl_document_pages TO service_role;

ALTER TABLE public.spl_document_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spl_document_pages_select ON public.spl_document_pages;
CREATE POLICY spl_document_pages_select ON public.spl_document_pages FOR SELECT USING (true);
DROP POLICY IF EXISTS spl_document_pages_insert ON public.spl_document_pages;
CREATE POLICY spl_document_pages_insert ON public.spl_document_pages FOR INSERT WITH CHECK (public.spl_ocs_can_manage());
DROP POLICY IF EXISTS spl_document_pages_update ON public.spl_document_pages;
CREATE POLICY spl_document_pages_update ON public.spl_document_pages FOR UPDATE USING (public.spl_ocs_can_manage()) WITH CHECK (public.spl_ocs_can_manage());
DROP POLICY IF EXISTS spl_document_pages_delete ON public.spl_document_pages;
CREATE POLICY spl_document_pages_delete ON public.spl_document_pages FOR DELETE USING (public.spl_ocs_can_manage());

CREATE INDEX IF NOT EXISTS spl_document_pages_doc_idx ON public.spl_document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS spl_document_pages_fts_idx ON public.spl_document_pages USING gin (to_tsvector('simple', normalized_text));
CREATE INDEX IF NOT EXISTS spl_document_pages_trgm_idx ON public.spl_document_pages USING gin (normalized_text gin_trgm_ops);