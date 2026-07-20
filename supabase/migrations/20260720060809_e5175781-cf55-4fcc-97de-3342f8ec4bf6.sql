
-- ============================================================
-- DMR (Daily Manpower Report) module
-- ============================================================

-- 1. System master
CREATE TABLE public.dmr_system_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline text NOT NULL CHECK (discipline IN ('ARCH','ELECT','MECH')),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discipline, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmr_system_master TO authenticated;
GRANT ALL ON public.dmr_system_master TO service_role;
ALTER TABLE public.dmr_system_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmr_system_master select auth" ON public.dmr_system_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "dmr_system_master write senior+" ON public.dmr_system_master
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'));

-- 2. Contractor master
CREATE TABLE public.dmr_contractor_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_direct boolean NOT NULL DEFAULT false,
  discipline_hint text[] DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmr_contractor_master TO authenticated;
GRANT ALL ON public.dmr_contractor_master TO service_role;
ALTER TABLE public.dmr_contractor_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmr_contractor_master select auth" ON public.dmr_contractor_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "dmr_contractor_master write senior+" ON public.dmr_contractor_master
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'));

-- 3. Long-format entries
CREATE TABLE public.dmr_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  discipline text NOT NULL CHECK (discipline IN ('ARCH','ELECT','MECH')),
  system_name text NOT NULL,
  system_id uuid REFERENCES public.dmr_system_master(id) ON DELETE SET NULL,
  contractor_name text NOT NULL,
  contractor_id uuid REFERENCES public.dmr_contractor_master(id) ON DELETE SET NULL,
  plot text NOT NULL CHECK (plot IN ('C','D','TOTAL')),
  metric text NOT NULL CHECK (metric IN ('target','today','yesterday')),
  manpower integer NOT NULL DEFAULT 0,
  source_image_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date, discipline, system_name, contractor_name, plot, metric)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmr_entries TO authenticated;
GRANT ALL ON public.dmr_entries TO service_role;
ALTER TABLE public.dmr_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmr_entries select auth" ON public.dmr_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "dmr_entries write senior+" ON public.dmr_entries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser') OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'));

CREATE INDEX dmr_entries_report_date_desc_idx ON public.dmr_entries (report_date DESC);
CREATE INDEX dmr_entries_discipline_date_idx ON public.dmr_entries (discipline, report_date DESC);
CREATE INDEX dmr_entries_contractor_date_idx ON public.dmr_entries (contractor_name, report_date DESC);
CREATE INDEX dmr_entries_system_idx ON public.dmr_entries (system_name);

-- updated_at trigger (reuse or create)
CREATE OR REPLACE FUNCTION public.dmr_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_dmr_system_master_touch BEFORE UPDATE ON public.dmr_system_master
  FOR EACH ROW EXECUTE FUNCTION public.dmr_touch_updated_at();
CREATE TRIGGER trg_dmr_contractor_master_touch BEFORE UPDATE ON public.dmr_contractor_master
  FOR EACH ROW EXECUTE FUNCTION public.dmr_touch_updated_at();
CREATE TRIGGER trg_dmr_entries_touch BEFORE UPDATE ON public.dmr_entries
  FOR EACH ROW EXECUTE FUNCTION public.dmr_touch_updated_at();
