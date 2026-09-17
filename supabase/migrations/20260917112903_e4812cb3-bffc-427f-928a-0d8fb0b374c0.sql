-- TOC 왕복 임포트 적재 정본 (spl_hdec_apply 구조 이식)
-- 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도. 실적 권위가 HDEC 이 아닌 단계(IFM·CMS)는
-- 값이 있을 때만 실적을 반영한다(빈칸이 기존 값을 지우지 않는다).
CREATE OR REPLACE FUNCTION public.toc_hdec_apply(
  _batch_id uuid,
  _patches jsonb,
  _allow_deletes boolean DEFAULT false,
  _delete_count integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.toc_items%ROWTYPE;
  v_auth text; v_code text; g jsonb;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_i0 int; v_s0 int; v_c0 int;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean; v_write_cv boolean;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  g := public.rcl_grants('TOC','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'TOC import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.toc_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'TOC import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('toc.change_source', 'hdec_import', true);
  PERFORM set_config('toc.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages; v_c0 := v_created;
    BEGIN
      SELECT * INTO it FROM public.toc_items WHERE item_key = p->>'item_key';

      IF NOT FOUND THEN
        IF nullif(p->>'plot','') IS NULL THEN
          RAISE EXCEPTION 'TOC import: cannot create % without plot', p->>'item_key';
        END IF;
        INSERT INTO public.toc_items(item_key, plot, team, team_raw, main_system, sub_system, item_no,
                                     location, supplier, pic, eng, created_by, updated_by)
        VALUES (p->>'item_key', p->>'plot',
          nullif(p->'item'->>'team',''), nullif(p->'item'->>'team_raw',''),
          nullif(p->'item'->>'main_system',''), nullif(p->'item'->>'sub_system',''),
          nullif(p->'item'->>'item_no',''), nullif(p->'item'->>'location',''),
          nullif(p->'item'->>'supplier',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
          auth.uid(), auth.uid())
        ON CONFLICT (item_key) DO NOTHING;
        v_created := v_created + 1;
        SELECT * INTO it FROM public.toc_items WHERE item_key = p->>'item_key';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'TOC import: failed to create %', p->>'item_key';
        END IF;
      END IF;

      IF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        UPDATE public.toc_items t SET
          item_no        = CASE WHEN p->'item' ? 'item_no'        THEN nullif(p->'item'->>'item_no','')        ELSE t.item_no END,
          main_system    = CASE WHEN p->'item' ? 'main_system'    THEN nullif(p->'item'->>'main_system','')    ELSE t.main_system END,
          sub_system     = CASE WHEN p->'item' ? 'sub_system'     THEN nullif(p->'item'->>'sub_system','')     ELSE t.sub_system END,
          location       = CASE WHEN p->'item' ? 'location'       THEN nullif(p->'item'->>'location','')       ELSE t.location END,
          team           = CASE WHEN p->'item' ? 'team'           THEN nullif(p->'item'->>'team','')           ELSE t.team END,
          team_raw       = CASE WHEN p->'item' ? 'team_raw'       THEN nullif(p->'item'->>'team_raw','')       ELSE t.team_raw END,
          supplier       = CASE WHEN p->'item' ? 'supplier'       THEN nullif(p->'item'->>'supplier','')       ELSE t.supplier END,
          pic            = CASE WHEN p->'item' ? 'pic'            THEN nullif(p->'item'->>'pic','')            ELSE t.pic END,
          eng            = CASE WHEN p->'item' ? 'eng'            THEN nullif(p->'item'->>'eng','')            ELSE t.eng END,
          toc_ref        = CASE WHEN p->'item' ? 'toc_ref'        THEN nullif(p->'item'->>'toc_ref','')        ELSE t.toc_ref END,
          expected_ho_date = CASE WHEN p->'item' ? 'expected_ho_date' THEN nullif(p->'item'->>'expected_ho_date','')::date ELSE t.expected_ho_date END,
          tac_qty_total  = CASE WHEN p->'item' ? 'tac_qty_total'  THEN nullif(p->'item'->>'tac_qty_total','')::int  ELSE t.tac_qty_total END,
          tac_qty_issued = CASE WHEN p->'item' ? 'tac_qty_issued' THEN nullif(p->'item'->>'tac_qty_issued','')::int ELSE t.tac_qty_issued END,
          abd_qty_total  = CASE WHEN p->'item' ? 'abd_qty_total'  THEN nullif(p->'item'->>'abd_qty_total','')::int  ELSE t.abd_qty_total END,
          abd_qty_code_a = CASE WHEN p->'item' ? 'abd_qty_code_a' THEN nullif(p->'item'->>'abd_qty_code_a','')::int ELSE t.abd_qty_code_a END,
          plot           = CASE WHEN p->'item' ? 'plot' AND nullif(p->'item'->>'plot','') IS NOT NULL
                                THEN p->'item'->>'plot' ELSE t.plot END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        SELECT actual_authority INTO v_auth
          FROM public.toc_stage_catalog WHERE stage_code = v_code;
        IF v_auth IS NULL THEN
          RAISE EXCEPTION 'TOC import: unknown stage_code %', v_code;
        END IF;

        v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
        v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);
        v_write_cv := (s ? 'code_value')    AND (v_auth = 'HDEC' OR nullif(s->>'code_value','')    IS NOT NULL);

        INSERT INTO public.toc_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, code_value)
        VALUES (it.id, v_code,
          CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date   ELSE NULL END,
          CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
          CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date  ELSE NULL END,
          CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
          CASE WHEN v_write_cv        THEN nullif(s->>'code_value','')         ELSE NULL END)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date   ELSE toc_stage_progress.plan_start END,
          actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE toc_stage_progress.actual_start END,
          plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date  ELSE toc_stage_progress.plan_finish END,
          actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE toc_stage_progress.actual_finish END,
          code_value    = CASE WHEN v_write_cv        THEN nullif(s->>'code_value','')         ELSE toc_stage_progress.code_value END,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.toc_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0;
      v_created := v_c0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'item_key',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('toc.change_source', 'app', true);
  PERFORM set_config('toc.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created,
    'stages_upserted', v_stages, 'rejected', v_rejected);
END;
$function$;

REVOKE ALL ON FUNCTION public.toc_hdec_apply(uuid, jsonb, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toc_hdec_apply(uuid, jsonb, boolean, integer) TO authenticated, service_role;

INSERT INTO public.toc_settings(key, value)
VALUES ('delete_guard', '{"pct": 5, "min_count": 50}'::jsonb)
ON CONFLICT (key) DO NOTHING;