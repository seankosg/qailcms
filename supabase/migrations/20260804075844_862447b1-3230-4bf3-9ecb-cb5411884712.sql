CREATE OR REPLACE FUNCTION public.hdec_recalc_owner_for_user(_user_id uuid, _reason text DEFAULT 'recalc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text; v_name text;
  v_cfg text[][] := ARRAY[
    ARRAY['task_management_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['abd_items_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['defect_items_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['spl_items','pic','eng'],
    ARRAY['wrt_items','pic','eng']
  ];
  i int; n int; total int := 0;
  v_mods jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.hdec_assert_admin();
  SELECT btrim(name), name_norm INTO v_name, v_norm FROM public.profiles WHERE id = _user_id;
  IF v_norm IS NULL THEN RAISE EXCEPTION 'user % 없음', _user_id; END IF;

  -- 소유권 계산은 하지 않는다. 대상 행을 no-op UPDATE 로 건드려
  -- BEFORE 트리거가 COALESCE 우선순위 규칙으로 스스로 재계산하게 한다.
  FOR i IN 1 .. array_length(v_cfg, 1) LOOP
    EXECUTE format(
      'WITH u AS (UPDATE public.%I SET updated_at = updated_at
                   WHERE (public.hdec_name_norm(%I) = $1 OR public.hdec_name_norm(%I) = $1)
                 RETURNING 1) SELECT count(*) FROM u',
      v_cfg[i][1], v_cfg[i][2], v_cfg[i][3])
      INTO n USING v_norm;
    total := total + n;
    v_mods := v_mods || jsonb_build_object('table', v_cfg[i][1], 'touched', n);
    IF n > 0 THEN
      INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
      VALUES (_reason, _user_id, v_name, v_name, v_cfg[i][1], 'owner_user_id', n, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('user_id', _user_id, 'name', v_name, 'total', total, 'modules', v_mods);
END $function$;