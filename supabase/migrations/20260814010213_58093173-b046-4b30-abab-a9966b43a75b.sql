CREATE OR REPLACE FUNCTION public.spl_reqdoc_set_required(_item_id uuid, _stage_code text, _required boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_band text; v_ok boolean;
BEGIN
  SELECT band INTO v_band FROM public.spl_stage_catalog WHERE stage_code = _stage_code;
  IF v_band IS DISTINCT FROM 'REQUIRED_DOC' THEN
    RAISE EXCEPTION 'Stage % is not a Required Document entry', _stage_code;
  END IF;
  SELECT public.rcl_can(auth.uid(), 'SPL', _item_id, 'write') INTO v_ok;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Permission denied: you cannot edit this row';
  END IF;

  PERFORM set_config('spl.change_source', 'reqdoc_ready_toggle', true);

  IF EXISTS (SELECT 1 FROM public.spl_stage_progress WHERE item_id = _item_id AND stage_code = _stage_code) THEN
    UPDATE public.spl_stage_progress
       SET flag_value = CASE WHEN _required THEN 'REQUIRED' ELSE NULL END,
           actual_start = CASE WHEN _required THEN actual_start ELSE NULL END,
           updated_at = now(), updated_by = auth.uid()
     WHERE item_id = _item_id AND stage_code = _stage_code;
  ELSE
    INSERT INTO public.spl_stage_progress(item_id, stage_code, flag_value, created_by, updated_by)
    VALUES (_item_id, _stage_code, CASE WHEN _required THEN 'REQUIRED' ELSE NULL END, auth.uid(), auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.spl_reqdoc_set_ready(_item_id uuid, _stage_code text, _ready boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_band text; v_ok boolean; v_flag text; v_today date;
BEGIN
  SELECT band INTO v_band FROM public.spl_stage_catalog WHERE stage_code = _stage_code;
  IF v_band IS DISTINCT FROM 'REQUIRED_DOC' THEN
    RAISE EXCEPTION 'Stage % is not a Required Document entry', _stage_code;
  END IF;
  SELECT public.rcl_can(auth.uid(), 'SPL', _item_id, 'write') INTO v_ok;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Permission denied: you cannot edit this row';
  END IF;

  SELECT flag_value INTO v_flag FROM public.spl_stage_progress
   WHERE item_id = _item_id AND stage_code = _stage_code;

  IF _ready AND coalesce(upper(btrim(v_flag)), '') <> 'REQUIRED' THEN
    RAISE EXCEPTION 'Stage % is not marked REQUIRED; cannot mark as received', _stage_code;
  END IF;

  PERFORM set_config('spl.change_source', 'reqdoc_ready_toggle', true);
  v_today := (now() AT TIME ZONE 'Asia/Qatar')::date;

  IF v_flag IS NOT NULL OR EXISTS (SELECT 1 FROM public.spl_stage_progress WHERE item_id = _item_id AND stage_code = _stage_code) THEN
    UPDATE public.spl_stage_progress
       SET actual_start = CASE WHEN _ready THEN v_today ELSE NULL END,
           updated_at = now(), updated_by = auth.uid()
     WHERE item_id = _item_id AND stage_code = _stage_code;
  END IF;

  RETURN jsonb_build_object('ok', true, 'actual_start', CASE WHEN _ready THEN v_today ELSE NULL END);
END; $$;

GRANT EXECUTE ON FUNCTION public.spl_reqdoc_set_required(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spl_reqdoc_set_ready(uuid, text, boolean) TO authenticated;