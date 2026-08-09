DO $mig$
DECLARE
  _fn text;
  _def text;
  _new text;
  _old_cols constant text := $t$'actual_start_date','actual_rectified_date','actual_closure_date','planned_progress_pct',$t$;
  _new_cols constant text := $t$'actual_start_date','actual_rectified_date','actual_closure_date',
    'planned_pre_inspection_date','actual_pre_inspection_date',
    'planned_dar_inspection_date','actual_dar_inspection_date',
    'planned_ho_date','actual_ho_date',
    'planned_progress_pct',$t$;
  _old_stages constant text := $t$_cell_stages constant text[] := array['start','rectified','closure'];$t$;
  _new_stages constant text := $t$_cell_stages constant text[] := array['start','rectified','pre_inspection','dar_inspection','closure','ho'];$t$;
  _old_np constant text := $t$          _np_sql := _np_sql || case _cs
            when 'start' then '(planned_start_date is null and actual_start_date is null)'
            when 'rectified' then '(planned_rectified_date is null and actual_rectified_date is null)'
            else '(planned_closure_date is null and actual_closure_date is null)' end;$t$;
  _new_np constant text := $t$          _np_sql := _np_sql || case _cs
            when 'start' then '(planned_start_date is null and actual_start_date is null)'
            when 'rectified' then '(planned_rectified_date is null and actual_rectified_date is null)'
            when 'pre_inspection' then '(planned_pre_inspection_date is null and actual_pre_inspection_date is null)'
            when 'dar_inspection' then '(planned_dar_inspection_date is null and actual_dar_inspection_date is null)'
            when 'ho' then '(planned_ho_date is null and actual_ho_date is null)'
            else '(planned_closure_date is null and actual_closure_date is null)' end;$t$;
BEGIN
  FOREACH _fn IN ARRAY ARRAY['defect_items_search','defect_items_facets','defect_items_search_ids'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = _fn;

    IF _def IS NULL THEN
      RAISE EXCEPTION 'function public.% not found', _fn;
    END IF;

    IF position(_old_cols IN _def) = 0 THEN
      RAISE EXCEPTION 'allowed-cols block not found in public.%', _fn;
    END IF;
    _new := replace(_def, _old_cols, _new_cols);

    IF _fn IN ('defect_items_search','defect_items_search_ids') THEN
      IF position(_old_stages IN _new) = 0 THEN
        RAISE EXCEPTION 'cell-stages block not found in public.%', _fn;
      END IF;
      _new := replace(_new, _old_stages, _new_stages);
    END IF;

    IF _fn = 'defect_items_search' THEN
      IF position(_old_np IN _new) = 0 THEN
        RAISE EXCEPTION 'no-plan block not found in public.%', _fn;
      END IF;
      _new := replace(_new, _old_np, _new_np);
    END IF;

    EXECUTE _new;
  END LOOP;
END
$mig$;