
CREATE TABLE public.abd_import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('hdec','aconex')),
  label text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX abd_import_presets_mode_sort_idx ON public.abd_import_presets(mode, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_import_presets TO authenticated;
GRANT ALL ON public.abd_import_presets TO service_role;

ALTER TABLE public.abd_import_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_import_presets_select_auth"
  ON public.abd_import_presets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "abd_import_presets_write_admin"
  ON public.abd_import_presets FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()) OR public.has_role(auth.uid(), 'd_superuser'::app_role))
  WITH CHECK (public.is_admin_or_super(auth.uid()) OR public.has_role(auth.uid(), 'd_superuser'::app_role));

CREATE TRIGGER abd_import_presets_touch
  BEFORE UPDATE ON public.abd_import_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
