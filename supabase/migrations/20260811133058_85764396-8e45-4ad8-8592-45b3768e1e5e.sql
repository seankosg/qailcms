CREATE OR REPLACE FUNCTION public.spl_aconex_apply(_batch_id uuid, _patches jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.spl_items%ROWTYPE;
  g jsonb; v_code text;
  v_items int := 0; v_stages int := 0;
  v_i0 int; v_s0 int;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  g := public.rcl_grants('SPL','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'SPL Aconex import: permission denied';
  END IF;

  PERFORM set_config('spl.change_source', 'aconex_import', true);
  PERFORM set_config('spl.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages;
    BEGIN
      SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SPL Aconex import: no matching item %', p->>'spl_number';
      END IF;

      IF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        IF NOT ((p->'item') - 'approval_status_raw') = '{}'::jsonb THEN
          RAISE EXCEPTION 'SPL Aconex import: only approval_status_raw is Aconex-owned (spl_number=%)', p->>'spl_number';
        END IF;
        UPDATE public.spl_items t SET
          approval_status_raw = CASE WHEN nullif(p->'item'->>'approval_status_raw','') IS NOT NULL
                                     THEN p->'item'->>'approval_status_raw' ELSE t.approval_status_raw END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        IF v_code <> 'APPROVAL_DATE' THEN
          RAISE EXCEPTION 'SPL Aconex import: stage % is not Aconex-owned', v_code;
        END IF;
        IF s ? 'plan_start' OR s ? 'plan_finish' THEN
          RAISE EXCEPTION 'SPL Aconex import: plan dates are HDEC-owned (spl_number=%)', p->>'spl_number';
        END IF;
        IF nullif(s->>'actual_start','') IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO public.spl_stage_progress(item_id, stage_code, actual_start)
        VALUES (it.id, v_code, (s->>'actual_start')::date)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          actual_start = (s->>'actual_start')::date,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.spl_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'spl_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('spl.change_source', 'app', true);
  PERFORM set_config('spl.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'stages_upserted', v_stages, 'rejected', v_rejected);
END;
$function$;

REVOKE ALL ON FUNCTION public.spl_aconex_apply(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spl_aconex_apply(uuid, jsonb) TO authenticated, service_role;