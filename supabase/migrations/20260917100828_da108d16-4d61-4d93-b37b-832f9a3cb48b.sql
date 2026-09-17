CREATE OR REPLACE FUNCTION public.toc_band_state(_item_id uuid, _band text, _as_of date DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  d date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_all int; v_na int; v_done int; v_act int; v_plan int; v_code_pending int; v_tac text;
BEGIN
  WITH st AS (
    SELECT c.value_type, p.code_value, c.done_codes,
           public.spl_stage_state(
             CASE WHEN c.value_type = 'code' THEN 'flag' ELSE c.value_type END,
             p.plan_start, p.plan_finish,
             CASE WHEN p.actual_start  <= d THEN p.actual_start  END,
             CASE WHEN p.actual_finish <= d THEN p.actual_finish END,
             public.toc_code_flag(c.value_type, p.code_value, c.done_codes),
             p.na_flag, d) AS state
    FROM public.toc_stage_catalog c
    LEFT JOIN public.toc_stage_progress p
      ON p.item_id = _item_id AND p.stage_code = c.stage_code
    WHERE c.band = _band
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE state = 'na')::int,
         count(*) FILTER (WHERE state = 'done')::int,
         count(*) FILTER (WHERE state IN ('wip','delayed'))::int,
         count(*) FILTER (WHERE state = 'planned')::int,
         -- 코드가 들어왔으나 완료 코드 사전에 없는 단계 = 진행 중(미착수가 아니다)
         count(*) FILTER (WHERE value_type = 'code'
                            AND state <> 'na'
                            AND nullif(btrim(coalesce(code_value,'')),'') IS NOT NULL
                            AND public.toc_code_flag(value_type, code_value, done_codes) IS NULL)::int
    INTO v_all, v_na, v_done, v_act, v_plan, v_code_pending
    FROM st;

  IF coalesce(v_all,0) = 0 THEN RETURN 'empty'; END IF;
  IF v_na = v_all THEN RETURN 'na'; END IF;
  -- 밴드는 정해진 체크리스트다: 비어 있는 단계가 남아 있으면 완료가 아니다.
  IF v_done > 0 AND (v_na + v_done) = v_all THEN RETURN 'complete'; END IF;

  IF _band = 'TRAINING' AND v_done = 0 AND v_act = 0 AND v_code_pending = 0 THEN
    v_tac := public.toc_band_state(_item_id, 'TAC', d);
    IF v_tac IS DISTINCT FROM 'complete' THEN RETURN 'blocked'; END IF;
  END IF;

  IF v_act > 0 OR v_code_pending > 0 OR v_done > 0 THEN RETURN 'active'; END IF;
  IF v_plan > 0 THEN RETURN 'planned'; END IF;
  RETURN 'empty';
END $$;