CREATE OR REPLACE FUNCTION public.wrt_aconex_apply(_batch_id uuid, _patches jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p jsonb; s jsonb; it public.wrt_items%ROWTYPE;
  g jsonb; v_code text;
  v_items int := 0; v_stages int := 0;
  v_i0 int; v_s0 int;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  g := public.rcl_grants('WRT','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'WRT Aconex import: permission denied';
  END IF;

  PERFORM set_config('wrt.change_source', 'aconex_import', true);
  PERFORM set_config('wrt.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages;
    BEGIN
      SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'WRT Aconex import: no matching item %', p->>'wrt_number';
      END IF;

      IF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        IF (p->'item') ?| ARRAY['dis','service','title','plot','team','pic','eng'] THEN
          RAISE EXCEPTION 'WRT authority violation: HDEC-owned field in Aconex patch (wrt_number=%)', p->>'wrt_number';
        END IF;
        UPDATE public.wrt_items t SET
          r1_response_code     = CASE WHEN p->'item' ? 'r1_response_code'     THEN nullif(p->'item'->>'r1_response_code','')     ELSE t.r1_response_code END,
          r1_response_code_raw = CASE WHEN p->'item' ? 'r1_response_code_raw' THEN nullif(p->'item'->>'r1_response_code_raw','') ELSE t.r1_response_code_raw END,
          r2_response_code     = CASE WHEN p->'item' ? 'r2_response_code'     THEN nullif(p->'item'->>'r2_response_code','')     ELSE t.r2_response_code END,
          r2_response_code_raw = CASE WHEN p->'item' ? 'r2_response_code_raw' THEN nullif(p->'item'->>'r2_response_code_raw','') ELSE t.r2_response_code_raw END,
          latest_response_code = CASE WHEN p->'item' ? 'latest_response_code' THEN nullif(p->'item'->>'latest_response_code','') ELSE t.latest_response_code END,
          latest_status_raw    = CASE WHEN p->'item' ? 'latest_status_raw'    THEN nullif(p->'item'->>'latest_status_raw','')    ELSE t.latest_status_raw END,
          is_final_approved    = CASE WHEN p->'item' ? 'is_final_approved'    THEN coalesce((p->'item'->>'is_final_approved')::boolean, t.is_final_approved) ELSE t.is_final_approved END,
          final_approved_raw   = CASE WHEN p->'item' ? 'final_approved_raw'   THEN nullif(p->'item'->>'final_approved_raw','')   ELSE t.final_approved_raw END,
          is_active            = CASE WHEN p->'item' ? 'is_active'            THEN coalesce((p->'item'->>'is_active')::boolean, t.is_active) ELSE t.is_active END,
          is_excluded          = CASE WHEN p->'item' ? 'is_excluded'          THEN coalesce((p->'item'->>'is_excluded')::boolean, t.is_excluded) ELSE t.is_excluded END,
          exclusion_reason     = CASE WHEN p->'item' ? 'exclusion_reason'     THEN nullif(p->'item'->>'exclusion_reason','')     ELSE t.exclusion_reason END,
          response_source      = CASE WHEN t.response_source IS DISTINCT FROM 'ACONEX' THEN 'ACONEX' ELSE t.response_source END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        IF v_code NOT IN ('RESPONSE_DATE_R1','RESPONSE_DATE_R2') THEN
          RAISE EXCEPTION 'WRT Aconex import: stage % is not Aconex-owned', v_code;
        END IF;
        IF nullif(s->>'actual_start','') IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO public.wrt_stage_progress(item_id, stage_code, actual_start)
        VALUES (it.id, v_code, (s->>'actual_start')::date)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          actual_start = (s->>'actual_start')::date,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.wrt_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'wrt_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('wrt.change_source', 'app', true);
  PERFORM set_config('wrt.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'stages_upserted', v_stages, 'rejected', v_rejected);
END;
$fn$;

REVOKE ALL ON FUNCTION public.wrt_aconex_apply(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wrt_aconex_apply(uuid, jsonb) TO authenticated;