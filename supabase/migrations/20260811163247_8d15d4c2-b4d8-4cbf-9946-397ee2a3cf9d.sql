CREATE TABLE IF NOT EXISTS public.pdb_module_filters (
  module text PRIMARY KEY,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.pdb_module_filters TO authenticated;
GRANT INSERT, UPDATE ON public.pdb_module_filters TO authenticated;
GRANT ALL ON public.pdb_module_filters TO service_role;

ALTER TABLE public.pdb_module_filters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdb_filters_read" ON public.pdb_module_filters;
CREATE POLICY "pdb_filters_read" ON public.pdb_module_filters
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pdb_filters_write" ON public.pdb_module_filters;
CREATE POLICY "pdb_filters_write" ON public.pdb_module_filters
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'));

INSERT INTO public.pdb_module_filters (module, filters) VALUES
  ('tm', '{"taskScope":"sub","disciplines":[],"workType":"all","delayFilter":"all","bucket":"week","startDate":null}'::jsonb),
  ('sm', '{"teams":[],"roomGroups":[],"buildings":[],"stage":"closure","planMode":"baseline","bucket":"week","unit":"cnt","startDate":null}'::jsonb),
  ('abd', '{"teams":[],"planMode":"baseline","bucket":"week","startDate":null}'::jsonb)
ON CONFLICT (module) DO NOTHING;