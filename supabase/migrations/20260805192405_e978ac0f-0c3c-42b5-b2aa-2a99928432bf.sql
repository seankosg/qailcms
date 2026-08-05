ALTER TABLE public.spl_items DROP CONSTRAINT IF EXISTS spl_items_team_check;
ALTER TABLE public.spl_items ADD CONSTRAINT spl_items_team_check
  CHECK (team IS NULL OR team = ANY (ARRAY['MECH','ELEC','PRJC']));

CREATE OR REPLACE FUNCTION public.wrt_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p jsonb; s jsonb; it public.wrt_items%ROWTYPE;
  v_auth text; v_code text;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]) THEN
    RAISE EXCEPTION 'WRT import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.wrt_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'WRT import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('wrt.change_source', 'hdec_import', true);
  PERFORM set_config('wrt.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';

    IF NOT FOUND THEN
      -- 미매칭 행 = 파일에만 있는 번호. HDEC 파일이 마스터이므로 신규 생성한다.
      IF nullif(p->>'plot','') IS NULL THEN
        RAISE EXCEPTION 'WRT import: cannot create % without plot', p->>'wrt_number';
      END IF;
      INSERT INTO public.wrt_items(wrt_number, plot, team, pic, eng, created_by, updated_by)
      VALUES (
        p->>'wrt_number', p->>'plot',
        nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
        auth.uid(), auth.uid()
      )
      ON CONFLICT (wrt_number) DO NOTHING;
      v_created := v_created + 1;
      SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WRT import: failed to create %', p->>'wrt_number';
      END IF;
    ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
      IF (p->'item') ?| ARRAY['r1_response_code','r2_response_code','latest_response_code','is_final_approved','dis','service','title','plot'] THEN
        RAISE EXCEPTION 'WRT authority violation: Aconex-owned item field in HDEC patch (wrt_number=%)', p->>'wrt_number';
      END IF;
      UPDATE public.wrt_items t SET
        team = CASE WHEN p->'item' ? 'team' THEN nullif(p->'item'->>'team','') ELSE t.team END,
        pic  = CASE WHEN p->'item' ? 'pic'  THEN nullif(p->'item'->>'pic','')  ELSE t.pic END,
        eng  = CASE WHEN p->'item' ? 'eng'  THEN nullif(p->'item'->>'eng','')  ELSE t.eng END,
        updated_by = auth.uid()
      WHERE t.id = it.id;
      v_items := v_items + 1;
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
      v_code := s->>'stage_code';
      SELECT actual_authority INTO v_auth FROM public.wrt_stage_catalog WHERE stage_code = v_code;
      IF v_auth IS NULL THEN
        RAISE EXCEPTION 'WRT import: unknown stage_code %', v_code;
      END IF;

      -- Aconex 권위 축: 값이 있을 때만 반영. 빈칸은 기존 값을 지우지 않는다.
      v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
      v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

      INSERT INTO public.wrt_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
      VALUES (
        it.id, v_code,
        CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
        CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
        CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
        CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
        CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END
      )
      ON CONFLICT (item_id, stage_code) DO UPDATE SET
        plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE wrt_stage_progress.plan_start END,
        actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE wrt_stage_progress.actual_start END,
        plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE wrt_stage_progress.plan_finish END,
        actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE wrt_stage_progress.actual_finish END,
        flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE wrt_stage_progress.flag_value END,
        updated_by = auth.uid();
      v_stages := v_stages + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('wrt.change_source', 'app', true);
  PERFORM set_config('wrt.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created, 'stages_upserted', v_stages, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.spl_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p jsonb; s jsonb; it public.spl_items%ROWTYPE;
  v_auth text; v_type text; v_code text;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]) THEN
    RAISE EXCEPTION 'SPL import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.spl_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'SPL import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('spl.change_source', 'hdec_import', true);
  PERFORM set_config('spl.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';

    IF NOT FOUND THEN
      IF nullif(p->>'plot','') IS NULL THEN
        RAISE EXCEPTION 'SPL import: cannot create % without plot', p->>'spl_number';
      END IF;
      INSERT INTO public.spl_items(spl_number, plot, team, pic, eng, pic_po, eng_po, supplier, created_by, updated_by)
      VALUES (
        p->>'spl_number', p->>'plot',
        nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
        nullif(p->'item'->>'pic_po',''), nullif(p->'item'->>'eng_po',''), nullif(p->'item'->>'supplier',''),
        auth.uid(), auth.uid()
      )
      ON CONFLICT (spl_number) DO NOTHING;
      v_created := v_created + 1;
      SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SPL import: failed to create %', p->>'spl_number';
      END IF;
    ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
      UPDATE public.spl_items t SET
        team    = CASE WHEN p->'item' ? 'team'     THEN nullif(p->'item'->>'team','')     ELSE t.team END,
        pic     = CASE WHEN p->'item' ? 'pic'      THEN nullif(p->'item'->>'pic','')      ELSE t.pic END,
        eng     = CASE WHEN p->'item' ? 'eng'      THEN nullif(p->'item'->>'eng','')      ELSE t.eng END,
        pic_po  = CASE WHEN p->'item' ? 'pic_po'   THEN nullif(p->'item'->>'pic_po','')   ELSE t.pic_po END,
        eng_po  = CASE WHEN p->'item' ? 'eng_po'   THEN nullif(p->'item'->>'eng_po','')   ELSE t.eng_po END,
        supplier= CASE WHEN p->'item' ? 'supplier' THEN nullif(p->'item'->>'supplier','') ELSE t.supplier END,
        updated_by = auth.uid()
      WHERE t.id = it.id;
      v_items := v_items + 1;
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
      v_code := s->>'stage_code';
      SELECT actual_authority, value_type INTO v_auth, v_type
        FROM public.spl_stage_catalog WHERE stage_code = v_code;
      IF v_auth IS NULL THEN
        RAISE EXCEPTION 'SPL import: unknown stage_code %', v_code;
      END IF;

      v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
      v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

      INSERT INTO public.spl_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
      VALUES (
        it.id, v_code,
        CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
        CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
        CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
        CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
        CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END
      )
      ON CONFLICT (item_id, stage_code) DO UPDATE SET
        plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE spl_stage_progress.plan_start END,
        actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE spl_stage_progress.actual_start END,
        plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE spl_stage_progress.plan_finish END,
        actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE spl_stage_progress.actual_finish END,
        flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE spl_stage_progress.flag_value END,
        updated_by = auth.uid();
      v_stages := v_stages + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('spl.change_source', 'app', true);
  PERFORM set_config('spl.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created, 'stages_upserted', v_stages, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$fn$;