CREATE TABLE public.defect_import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.defect_import_presets TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.defect_import_presets TO authenticated;
GRANT ALL ON public.defect_import_presets TO service_role;

ALTER TABLE public.defect_import_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_import_presets_select_all"
  ON public.defect_import_presets FOR SELECT
  USING (true);

CREATE POLICY "defect_import_presets_admin_write"
  ON public.defect_import_presets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'd_superuser'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'd_superuser'));

CREATE TRIGGER update_defect_import_presets_updated_at
  BEFORE UPDATE ON public.defect_import_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.defect_import_presets (label, fields, sort_order) VALUES
  ('Update from Aconex', ARRAY['source_issue_no','status_raw','updated_status','updated_date_raw','priority','classification','category'], 10),
  ('HDEC''s Update', ARRAY['source_issue_no','team','subcontractor_name','subsub_name','hdec_pic_name','hdec_eng_name','planned_start_date','planned_rectified_date','planned_closure_date','actual_start_date','actual_rectified_date','actual_closure_date'], 20),
  ('Cat Check', ARRAY['source_issue_no','description','priority','hdec_verification','hdec_reason','closure_status','actual_closure_date','status_raw'], 30);
