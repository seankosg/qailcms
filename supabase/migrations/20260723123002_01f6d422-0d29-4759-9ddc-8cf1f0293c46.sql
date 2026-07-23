
CREATE TABLE public.import_field_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('task_management','defect','abd','spare_part')),
  row_log_id uuid,
  raw_row_no integer,
  field_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'applied','unchanged','derived','auto_filled','corrected',
    'skipped_empty','skipped_clear_blocked','skipped_no_permission',
    'rejected_invalid','rejected_conflict','info'
  )),
  raw_value text,
  applied_value text,
  previous_value text,
  reason_code text,
  reason_detail text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_field_logs_upload ON public.import_field_logs(upload_id);
CREATE INDEX idx_import_field_logs_upload_outcome ON public.import_field_logs(upload_id, outcome);
CREATE INDEX idx_import_field_logs_upload_field ON public.import_field_logs(upload_id, field_name);
CREATE INDEX idx_import_field_logs_row_log ON public.import_field_logs(row_log_id);

GRANT SELECT, INSERT ON public.import_field_logs TO authenticated;
GRANT ALL ON public.import_field_logs TO service_role;

ALTER TABLE public.import_field_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read import field logs"
ON public.import_field_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Upload owners or admins can insert import field logs"
ON public.import_field_logs FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'd_superuser'::app_role)
  OR public.has_role(auth.uid(), 'senior_user'::app_role)
  OR public.has_role(auth.uid(), 'superuser'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.task_management_import_logs t WHERE t.id = upload_id AND t.imported_by = auth.uid())
  OR EXISTS (SELECT 1 FROM public.defect_import_logs d WHERE d.id = upload_id AND d.imported_by = auth.uid())
  OR EXISTS (SELECT 1 FROM public.abd_import_logs a WHERE a.id = upload_id AND a.imported_by = auth.uid())
  OR EXISTS (SELECT 1 FROM public.spare_parts_import_logs s WHERE s.id = upload_id AND s.executed_by = auth.uid())
);

CREATE POLICY "Admins can delete import field logs"
ON public.import_field_logs FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'd_superuser'::app_role)
  OR public.has_role(auth.uid(), 'senior_user'::app_role)
  OR public.has_role(auth.uid(), 'superuser'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);
