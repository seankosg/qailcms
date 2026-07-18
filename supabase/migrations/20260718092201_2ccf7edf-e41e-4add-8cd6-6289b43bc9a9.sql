
CREATE OR REPLACE FUNCTION public.defect_items_facets(_column text, _status_group text DEFAULT 'unclosed'::text, _include_inactive boolean DEFAULT false)
 RETURNS TABLE(value text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  _allowed_cols constant text[] := array[
    -- 기존 허용 컬럼
    'team','status_raw','rectified_status','closure_status','priority','hdec_verification',
    'classification','category','defect_type','area_type','area_level','area_location',
    'main_trade','sub_trade','work_type','subcontractor_name','subsub_name','hdec_pic_name',
    'hdec_eng_name','plan_title','plan_group','created_by_name','created_by_team_name',
    'assigned_to','classification_source','item','captured_by_name','subcontractor_issue_no',
    'subcontractor_issue_source','area_raw','trade_detail','aconex_comments','hdec_reason',
    -- 텍스트값이 있는 컬럼 추가 (list-select 필터 지원)
    'source_issue_no','issue_no','description','location_raw','defect_location',
    'location_reference','podium_area','building','room','room_group','level_name',
    'ir','forms','review_flag','updated_status','updated_description','updated_by_name',
    'remarks','hdec_comments','status_group','sub_trade'
  ];
  _where text := 'true';
  _sql text;
begin
  if not (_column = any(_allowed_cols)) then
    raise exception 'Column % not allowed for facets', _column;
  end if;

  if _status_group in ('unclosed','closed') then
    _where := _where || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where := _where || ' and is_active = true';
  end if;

  _sql := format(
    'select %I::text as value, count(*)::bigint as cnt
       from public.defect_items_raw
      where %s and %I is not null and %I::text <> ''''
      group by %I
      order by cnt desc, value asc
      limit 500',
    _column, _where, _column, _column, _column
  );
  return query execute _sql;
end;
$function$;
