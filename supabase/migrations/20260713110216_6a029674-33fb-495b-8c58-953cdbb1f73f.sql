CREATE TABLE IF NOT EXISTS public.defect_category_team_map (
  category text PRIMARY KEY,
  team text NOT NULL CHECK (team IN ('Arch','Mech','Elec')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_category_team_map TO authenticated;
GRANT ALL ON public.defect_category_team_map TO service_role;

ALTER TABLE public.defect_category_team_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users can read category team map"
  ON public.defect_category_team_map FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins can insert category team map"
  ON public.defect_category_team_map FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'));

CREATE POLICY "admins can update category team map"
  ON public.defect_category_team_map FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'));

CREATE POLICY "admins can delete category team map"
  ON public.defect_category_team_map FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'));

CREATE OR REPLACE FUNCTION public.set_defect_category_team_map_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_defect_category_team_map_updated_at
  BEFORE UPDATE ON public.defect_category_team_map
  FOR EACH ROW EXECUTE FUNCTION public.set_defect_category_team_map_updated_at();

INSERT INTO public.defect_category_team_map (category, team) VALUES
  ('Architectural', 'Arch'),
  ('Architecture', 'Arch'),
  ('Civil', 'Arch'),
  ('Structural', 'Arch'),
  ('Façade', 'Arch'),
  ('Facade', 'Arch'),
  ('Acoustics', 'Arch'),
  ('Quality', 'Arch'),
  ('Electrical', 'Elec'),
  ('MEP-Electrical', 'Elec'),
  ('MEP-ELV', 'Elec'),
  ('Mechanical', 'Mech'),
  ('MEP-Mechanical', 'Mech'),
  ('Plumbing', 'Mech'),
  ('Fire Fighting', 'Mech'),
  ('Gas', 'Mech')
ON CONFLICT (category) DO NOTHING;
