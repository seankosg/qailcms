CREATE TABLE public.dmr_entry_templates (
  scope text PRIMARY KEY CHECK (scope IN ('ALL','ARCH','ELEC','MECH')),
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmr_entry_templates TO authenticated;
GRANT ALL ON public.dmr_entry_templates TO service_role;

ALTER TABLE public.dmr_entry_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dmr templates readable by authenticated"
ON public.dmr_entry_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "dmr templates writable by editors"
ON public.dmr_entry_templates FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'system_administrator') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser') OR public.has_role(auth.uid(), 'd_superuser') OR public.has_role(auth.uid(), 'senior_user'))
WITH CHECK (public.has_role(auth.uid(), 'system_administrator') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser') OR public.has_role(auth.uid(), 'd_superuser') OR public.has_role(auth.uid(), 'senior_user'));