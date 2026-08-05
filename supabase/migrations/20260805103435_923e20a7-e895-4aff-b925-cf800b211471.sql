DO $mig$
DECLARE
  _old text := $blk$  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(both '"' from trim(x))
      from regexp_split_to_table(_q, ',') as x
      where length(trim(both '"' from trim(x))) > 0
    loop
      if _token ~ '^[0-9]+$' then
        _where_sql := _where_sql || format(' and source_issue_no ilike %L', '%' || _token || '%');
      else
        _field_sql := '';
        foreach _search_field in array _search_cols loop
          if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
          _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
        end loop;
        if _field_sql <> '' then
          _where_sql := _where_sql || format(' and (%s)', _field_sql);
        end if;
      end if;
    end loop;
  end if;$blk$;
  _new text := $blk$  if _q is not null and length(trim(_q)) > 0 then
    declare
      _q_sql text := '';
      _tok_sql text;
    begin
      for _token in
        select trim(both '"' from trim(x))
        from regexp_split_to_table(_q, ',') as x
        where length(trim(both '"' from trim(x))) > 0
      loop
        _tok_sql := null;
        if _token ~ '^[0-9]+$' then
          _tok_sql := format('(source_issue_no::text ilike %L or subcontractor_issue_no::text ilike %L or issue_no::text ilike %L)',
            '%' || _token || '%', '%' || _token || '%', '%' || _token || '%');
        else
          _field_sql := '';
          foreach _search_field in array _search_cols loop
            if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
            _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
          end loop;
          if _field_sql <> '' then
            _tok_sql := '(' || _field_sql || ')';
          end if;
        end if;
        if _tok_sql is not null then
          if _q_sql <> '' then _q_sql := _q_sql || ' or '; end if;
          _q_sql := _q_sql || _tok_sql;
        end if;
      end loop;
      if _q_sql <> '' then
        _where_sql := _where_sql || format(' and (%s)', _q_sql);
      end if;
    end;
  end if;$blk$;
  r record;
  d text;
BEGIN
  FOR r IN
    SELECT oid, proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('defect_items_search','defect_items_search_ids','defect_items_facets')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF strpos(d, _old) = 0 THEN
      RAISE EXCEPTION 'q-block not found in %', r.proname;
    END IF;
    EXECUTE replace(d, _old, _new);
  END LOOP;
END
$mig$;