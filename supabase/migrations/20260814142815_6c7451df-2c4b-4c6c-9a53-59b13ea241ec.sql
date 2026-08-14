-- SPL 설정·매핑 4표: 하드코딩 역할 → RCL 격자(rcl_grants('SPL','write')) 이관
-- 규칙: SELECT 는 건드리지 않는다 / FOR ALL 은 INSERT·UPDATE·DELETE 로 쪼갠다 / 옛 정책은 반드시 지운다

DROP POLICY IF EXISTS spl_field_config_admin_write ON public.spl_field_config;
CREATE POLICY spl_field_config_rcl_insert ON public.spl_field_config FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_field_config_rcl_update ON public.spl_field_config FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_field_config_rcl_delete ON public.spl_field_config FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

DROP POLICY IF EXISTS spl_header_mappings_admin_write ON public.spl_header_mappings;
CREATE POLICY spl_header_mappings_rcl_insert ON public.spl_header_mappings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_header_mappings_rcl_update ON public.spl_header_mappings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_header_mappings_rcl_delete ON public.spl_header_mappings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

DROP POLICY IF EXISTS spl_import_presets_admin_write ON public.spl_import_presets;
CREATE POLICY spl_import_presets_rcl_insert ON public.spl_import_presets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_import_presets_rcl_update ON public.spl_import_presets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_import_presets_rcl_delete ON public.spl_import_presets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));

DROP POLICY IF EXISTS spl_settings_write ON public.spl_settings;
CREATE POLICY spl_settings_rcl_insert ON public.spl_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_settings_rcl_update ON public.spl_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));
CREATE POLICY spl_settings_rcl_delete ON public.spl_settings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('SPL','write') g
    WHERE COALESCE((g->>'own')::boolean,false) OR COALESCE((g->>'own_team')::boolean,false) OR COALESCE((g->>'other_team')::boolean,false)));