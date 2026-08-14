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

  PERFORM set_config('spl.change_source', 'reqdoc_required_toggle', true);

  IF EXISTS (SELECT 1 FROM public.spl_stage_progress WHERE item_id = _item_id AND stage_code = _stage_code) THEN
    UPDATE public.spl_stage_progress
       SET flag_value = CASE WHEN _required THEN 'REQUIRED' ELSE 'N/A' END,
           actual_start = CASE WHEN _required THEN actual_start ELSE NULL END,
           updated_at = now(), updated_by = auth.uid()
     WHERE item_id = _item_id AND stage_code = _stage_code;
  ELSE
    INSERT INTO public.spl_stage_progress(item_id, stage_code, flag_value, created_by, updated_by)
    VALUES (_item_id, _stage_code, CASE WHEN _required THEN 'REQUIRED' ELSE 'N/A' END, auth.uid(), auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.spl_reqdoc_set_required(uuid, text, boolean) TO authenticated;