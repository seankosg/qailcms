-- 1) toc_status 에 Code B 허용
ALTER TABLE public.toc_items DROP CONSTRAINT IF EXISTS toc_items_toc_status_check;
ALTER TABLE public.toc_items ADD CONSTRAINT toc_items_toc_status_check
  CHECK (toc_status = ANY (ARRAY['Not Submitted'::text,'UR IFM'::text,'Code A'::text,'Code B'::text,'Code C'::text]));

-- 2) 교육 실적 가드 완화: TAC 완료 OR toc_status in (Code A, Code B)
CREATE OR REPLACE FUNCTION public.toc_assert_row_rules(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_status text; v_has_actual boolean;
BEGIN
  IF coalesce(current_setting('toc.seed', true), '') = 'on' THEN RETURN; END IF;

  SELECT item_key, toc_status INTO v_key, v_status FROM public.toc_items WHERE id = _item_id;
  IF v_key IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.toc_stage_catalog c
    JOIN public.toc_stage_progress p ON p.item_id = _item_id AND p.stage_code = c.stage_code
    WHERE c.band = 'TRAINING'
      AND NOT coalesce(p.na_flag, false)
      AND (p.actual_start IS NOT NULL OR p.actual_finish IS NOT NULL
           OR nullif(btrim(coalesce(p.code_value,'')),'') IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM public.toc_item_training_links l
    JOIN public.toc_training_sessions s ON s.id = l.session_id
    WHERE l.item_id = _item_id AND s.conducted_date IS NOT NULL
  ) INTO v_has_actual;

  -- Code B 는 최종 Code A 가 필요하지만 교육은 진행할 수 있다.
  IF v_has_actual
     AND public.toc_band_state(_item_id, 'TAC') IS DISTINCT FROM 'complete'
     AND coalesce(v_status,'') NOT IN ('Code A','Code B') THEN
    RAISE EXCEPTION
      E'%s: Training actuals cannot be recorded.\nTesting & Commissioning (T&C) is not complete for this sub system.',
      v_key USING ERRCODE = '23514';
  END IF;
END $function$;

-- 3) 전기 T&C 대응표
CREATE TABLE public.toc_elec_system_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plot text NOT NULL DEFAULT 'D' CHECK (plot = ANY (ARRAY['C'::text,'D'::text])),
  team text NOT NULL DEFAULT 'ELEC' CHECK (team = ANY (ARRAY['MECH'::text,'ELEC'::text,'ARCH'::text,'PRJC'::text])),
  source_system text NOT NULL DEFAULT '',
  source_sub text NOT NULL DEFAULT '',
  source_description text NOT NULL DEFAULT '',
  item_key text NULL,
  is_active boolean NOT NULL DEFAULT true,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  CONSTRAINT toc_elec_system_map_uq UNIQUE (plot, source_system, source_sub, source_description)
);
CREATE INDEX toc_elec_system_map_item_key_idx ON public.toc_elec_system_map (item_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_elec_system_map TO authenticated;
GRANT ALL ON public.toc_elec_system_map TO service_role;

ALTER TABLE public.toc_elec_system_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "toc_elec_map_select" ON public.toc_elec_system_map
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "toc_elec_map_write" ON public.toc_elec_system_map
  FOR ALL TO authenticated
  USING (public.rcl_max_scope(auth.uid(),'TOC','import') IS NOT NULL)
  WITH CHECK (public.rcl_max_scope(auth.uid(),'TOC','import') IS NOT NULL);

CREATE OR REPLACE FUNCTION public.toc_elec_map_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  IF TG_OP = 'INSERT' THEN NEW.created_by = coalesce(NEW.created_by, auth.uid()); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER toc_elec_map_touch_trg
BEFORE INSERT OR UPDATE ON public.toc_elec_system_map
FOR EACH ROW EXECUTE FUNCTION public.toc_elec_map_touch();