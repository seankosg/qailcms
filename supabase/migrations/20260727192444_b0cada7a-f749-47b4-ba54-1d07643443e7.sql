-- 기존 시그니처(축 1개) 제거 후, 축 목록 배열을 받는 새 시그니처로 재작성
DROP FUNCTION IF EXISTS public.tm_items_facets(text, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.tm_items_facets(
  _columns text[],
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _include_inactive boolean DEFAULT false
) RETURNS TABLE(axis text, value text, cnt bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
declare
  _allowed_facets constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment'
  ];
  _allowed_filter_cols constant text[] := array[
    'discipline','plot','team','risk','status_manual','milestone',
    'hdec_pic_name','hdec_eng_name','plan_overdue','actual_overdue','auto_judgment',
    'category','row_type','level','floor_level'
  ];
  _search_cols constant text[] := array[
    'task_no','main_task_no','discipline','category','plot','task_name','sub_task_desc',
    'team','location','floor_level','hdec_pic_name','hdec_eng_name','milestone','status_manual','risk'
  ];
  _base_where text := 'true';
  _where text;
  _filter jsonb;
  _col text; _op text; _val jsonb;
  _token text; _field_sql text; _search_field text;
  _axis text;
  _union text := '';
  _sql text;
begin
  if _columns is null or array_length(_columns, 1) is null then
    return;
  end if;

  if not _include_inactive then
    _base_where := _base_where || ' and is_active = true';
  end if;

  -- 검색어(공용)
  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(both '"' from trim(x))
      from regexp_split_to_table(_q, ',') as x
      where length(trim(both '"' from trim(x))) > 0
    loop
      _field_sql := '';
      foreach _search_field in array _search_cols loop
        if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
        _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
      end loop;
      if _field_sql <> '' then _base_where := _base_where || format(' and (%s)', _field_sql); end if;
    end loop;
  end if;

  -- 축별 UNION ALL: 각 축에서 자기 축은 cross-filter로 제외
  foreach _axis in array _columns loop
    if not (_axis = any(_allowed_facets)) then continue; end if;

    _where := _base_where;

    for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
      _col := _filter->>'column';
      _op  := coalesce(_filter->>'op', 'in');
      _val := _filter->'value';
      if _col is null or not (_col = any(_allowed_filter_cols)) then continue; end if;
      if _col = _axis then continue; end if; -- self axis skip

      if _op = 'in' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where := _where || format(
          ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
      elsif _op = 'in_or_empty' and jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where := _where || format(
          ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
          _col, _val, _col, _col);
      elsif _op = 'empty' then
        _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
      end if;
    end loop;

    if _union <> '' then _union := _union || ' UNION ALL '; end if;
    _union := _union || format(
      'select %L::text as axis, %I::text as value, count(*)::bigint as cnt
         from public.v_task_management_raw_derived
        where %s and %I is not null and %I::text <> ''''
        group by %I',
      _axis, _axis, _where, _axis, _axis, _axis);
  end loop;

  if _union = '' then return; end if;

  _sql := 'select axis, value, cnt from (' || _union
       || ') u order by axis asc, cnt desc, value asc';
  return query execute _sql;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_items_facets(text[], text, jsonb, boolean) TO authenticated, anon, service_role;