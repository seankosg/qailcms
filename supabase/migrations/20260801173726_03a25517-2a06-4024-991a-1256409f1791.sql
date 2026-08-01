CREATE OR REPLACE FUNCTION public.wrt_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.wrt_items%ROWTYPE;
  v_auth text; v_code text;
  v_items int := 0; v_stages int := 0;
  v_unmatched text[] := '{}';
  v_pct numeric; v_min int; v_total int;
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
      v_unmatched := v_unmatched || (p->>'wrt_number');
      CONTINUE;
    END IF;

    IF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
      -- Aconex 정본(회신코드/최종승인/식별정보)은 여기서 절대 갱신하지 않는다
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

      IF v_auth <> 'HDEC' AND (s ? 'actual_start' OR s ? 'actual_finish') THEN
        RAISE EXCEPTION 'WRT authority violation: stage % actual is owned by % — HDEC import must not write actual dates (wrt_number=%)',
          v_code, v_auth, p->>'wrt_number';
      END IF;

      INSERT INTO public.wrt_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
      VALUES (
        it.id, v_code,
        CASE WHEN s ? 'plan_start'    THEN nullif(s->>'plan_start','')::date    ELSE NULL END,
        CASE WHEN s ? 'actual_start'  THEN nullif(s->>'actual_start','')::date  ELSE NULL END,
        CASE WHEN s ? 'plan_finish'   THEN nullif(s->>'plan_finish','')::date   ELSE NULL END,
        CASE WHEN s ? 'actual_finish' THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
        CASE WHEN s ? 'flag_value'    THEN nullif(s->>'flag_value','')          ELSE NULL END
      )
      ON CONFLICT (item_id, stage_code) DO UPDATE SET
        plan_start    = CASE WHEN s ? 'plan_start'    THEN nullif(s->>'plan_start','')::date    ELSE wrt_stage_progress.plan_start END,
        actual_start  = CASE WHEN s ? 'actual_start'  THEN nullif(s->>'actual_start','')::date  ELSE wrt_stage_progress.actual_start END,
        plan_finish   = CASE WHEN s ? 'plan_finish'   THEN nullif(s->>'plan_finish','')::date   ELSE wrt_stage_progress.plan_finish END,
        actual_finish = CASE WHEN s ? 'actual_finish' THEN nullif(s->>'actual_finish','')::date ELSE wrt_stage_progress.actual_finish END,
        flag_value    = CASE WHEN s ? 'flag_value'    THEN nullif(s->>'flag_value','')          ELSE wrt_stage_progress.flag_value END,
        updated_by = auth.uid();
      v_stages := v_stages + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('wrt.change_source', 'app', true);
  PERFORM set_config('wrt.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'stages_upserted', v_stages, 'unmatched', to_jsonb(v_unmatched));
END; $function$;

REVOKE ALL ON FUNCTION public.wrt_hdec_apply(uuid, jsonb, boolean, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wrt_hdec_apply(uuid, jsonb, boolean, integer) TO authenticated, service_role;