DO $mig$
DECLARE
  _def text;
  _anchor text := '    if _op in (''stage_plan_range'',''stage_actual_range'') then';
  _branch text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _def
  FROM pg_proc WHERE proname = 'defect_items_search' AND pronamespace = 'public'::regnamespace;
  IF _def IS NULL THEN RAISE EXCEPTION 'defect_items_search not found'; END IF;
  IF position('stage_no_plan' in _def) > 0 THEN RAISE NOTICE 'already patched'; RETURN; END IF;
  IF position(_anchor in _def) = 0 THEN RAISE EXCEPTION 'anchor not found'; END IF;

  _branch := $b$    -- NO PLAN KPI 드릴다운: 스테이지 계획일 NULL (실적일도 NULL) — totals 의 no_plan 정의와 동일
    if _op = 'stage_no_plan' then
      if _val is null then continue; end if;
      declare
        _stages text[];
        _np_sql text := '';
      begin
        if jsonb_typeof(_val) = 'array' then
          _stages := array(select jsonb_array_elements_text(_val));
        else
          _stages := string_to_array(coalesce(_val->>'stages',''), ',');
        end if;
        if _stages is null or cardinality(_stages) = 0 then continue; end if;
        foreach _cs in array _stages loop
          _cs := trim(_cs);
          if _cs = '' then continue; end if;
          if not (_cs = any(_cell_stages)) then
            raise exception 'defect_items_search: unknown no-plan stage %', _cs;
          end if;
          if _np_sql <> '' then _np_sql := _np_sql || ' or '; end if;
          _np_sql := _np_sql || case _cs
            when 'start' then '(planned_start_date is null and actual_start_date is null)'
            when 'rectified' then '(planned_rectified_date is null and actual_rectified_date is null)'
            else '(planned_closure_date is null and actual_closure_date is null)' end;
        end loop;
        if _np_sql <> '' then
          _where_sql := _where_sql || format(' and (%s)', _np_sql);
        end if;
      end;
      continue;
    end if;

$b$;

  _def := replace(_def, _anchor, _branch || _anchor);
  EXECUTE _def;
END
$mig$;