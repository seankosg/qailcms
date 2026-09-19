CREATE TABLE public.toc_mech_system_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plot text NOT NULL DEFAULT 'D' CHECK (plot IN ('C','D')),
  team text NOT NULL DEFAULT 'MECH' CHECK (team = 'MECH'),
  source_system text NOT NULL DEFAULT '',
  source_description text NOT NULL DEFAULT '',
  item_key text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT toc_mech_system_map_uniq UNIQUE (plot, source_system, source_description)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_mech_system_map TO authenticated;
GRANT ALL ON public.toc_mech_system_map TO service_role;

CREATE INDEX toc_mech_system_map_item_key_idx ON public.toc_mech_system_map (item_key);

ALTER TABLE public.toc_mech_system_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "toc_mech_map_select" ON public.toc_mech_system_map
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "toc_mech_map_write" ON public.toc_mech_system_map
  FOR ALL TO authenticated
  USING (public.rcl_max_scope(auth.uid(), 'TOC', 'import') IS NOT NULL)
  WITH CHECK (public.rcl_max_scope(auth.uid(), 'TOC', 'import') IS NOT NULL);

CREATE OR REPLACE FUNCTION public.toc_mech_map_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER toc_mech_system_map_touch
BEFORE INSERT OR UPDATE ON public.toc_mech_system_map
FOR EACH ROW EXECUTE FUNCTION public.toc_mech_map_touch();