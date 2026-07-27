
CREATE TABLE IF NOT EXISTS public.tm_milestone_kinds (
  kind_code text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tm_milestone_kinds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tm_milestone_kinds TO authenticated;
GRANT ALL ON public.tm_milestone_kinds TO service_role;

ALTER TABLE public.tm_milestone_kinds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tm_milestone_kinds_read_authenticated"
  ON public.tm_milestone_kinds FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "tm_milestone_kinds_admin_write"
  ON public.tm_milestone_kinds FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','d_superuser']::app_role[]));

CREATE POLICY "tm_milestone_kinds_admin_update"
  ON public.tm_milestone_kinds FOR UPDATE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','d_superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','d_superuser']::app_role[]));

CREATE POLICY "tm_milestone_kinds_admin_delete"
  ON public.tm_milestone_kinds FOR DELETE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','d_superuser']::app_role[]));

CREATE TRIGGER trg_tm_milestone_kinds_updated_at
  BEFORE UPDATE ON public.tm_milestone_kinds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tm_milestone_kinds (kind_code, label, sort_order)
VALUES ('HO', 'HO', 10), ('COC', 'COC', 20), ('DLP', 'DLP', 30)
ON CONFLICT (kind_code) DO NOTHING;
