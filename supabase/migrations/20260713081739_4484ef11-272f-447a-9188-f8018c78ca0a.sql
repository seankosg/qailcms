
CREATE TABLE public.abd_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.abd_import_logs(id) ON DELETE CASCADE,
  raw_row_no integer,
  team text,
  abd_number text,
  action_taken text NOT NULL,
  reason_code text,
  reason_detail text,
  processed_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX idx_abd_import_row_logs_upload ON public.abd_import_row_logs(upload_id);
CREATE INDEX idx_abd_import_row_logs_number ON public.abd_import_row_logs(abd_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_import_row_logs TO authenticated;
GRANT ALL ON public.abd_import_row_logs TO service_role;

ALTER TABLE public.abd_import_row_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_import_row_logs_select" ON public.abd_import_row_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "abd_import_row_logs_insert" ON public.abd_import_row_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.abd_import_logs l
      WHERE l.id = upload_id
        AND (l.imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()))
    )
  );

CREATE POLICY "abd_import_row_logs_admin_delete" ON public.abd_import_row_logs
  FOR DELETE TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- also delete row logs alongside a batch deletion
CREATE OR REPLACE FUNCTION public.delete_abd_import_batch(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _deleted int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  WITH del AS (DELETE FROM public.abd_items_raw WHERE source_import_log_id = _batch_id RETURNING id)
  SELECT count(*) INTO _deleted FROM del;
  DELETE FROM public.abd_change_log WHERE upload_id = _batch_id;
  DELETE FROM public.abd_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.abd_import_logs WHERE id = _batch_id;
  RETURN jsonb_build_object('deleted_rows', _deleted);
END $$;
