
-- 1) Rename columns
ALTER TABLE public.defect_items_raw RENAME COLUMN completion_status TO rectified_status;
ALTER TABLE public.defect_items_raw RENAME COLUMN planned_completion_date TO planned_rectified_date;
ALTER TABLE public.defect_items_raw RENAME COLUMN actual_completion_date TO actual_rectified_date;

-- 2) Recreate suppression + history triggers FIRST (before any UPDATE fires them)
CREATE OR REPLACE FUNCTION public.trg_defect_suppress_noop_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.team IS NOT DISTINCT FROM OLD.team
     AND NEW.source_issue_no IS NOT DISTINCT FROM OLD.source_issue_no
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.location_raw IS NOT DISTINCT FROM OLD.location_raw
     AND NEW.plan_title IS NOT DISTINCT FROM OLD.plan_title
     AND NEW.plan_group IS NOT DISTINCT FROM OLD.plan_group
     AND NEW.status_raw IS NOT DISTINCT FROM OLD.status_raw
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.defect_type IS NOT DISTINCT FROM OLD.defect_type
     AND NEW.item IS NOT DISTINCT FROM OLD.item
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.priority IS NOT DISTINCT FROM OLD.priority
     AND NEW.due_by IS NOT DISTINCT FROM OLD.due_by
     AND NEW.created_by_name IS NOT DISTINCT FROM OLD.created_by_name
     AND NEW.created_by_team_name IS NOT DISTINCT FROM OLD.created_by_team_name
     AND NEW.created_date IS NOT DISTINCT FROM OLD.created_date
     AND NEW.ir IS NOT DISTINCT FROM OLD.ir
     AND NEW.forms IS NOT DISTINCT FROM OLD.forms
     AND NEW.last_updated_at IS NOT DISTINCT FROM OLD.last_updated_at
     AND NEW.updated_description IS NOT DISTINCT FROM OLD.updated_description
     AND NEW.updated_by_name IS NOT DISTINCT FROM OLD.updated_by_name
     AND NEW.updated_status IS NOT DISTINCT FROM OLD.updated_status
     AND NEW.updated_date_raw IS NOT DISTINCT FROM OLD.updated_date_raw
     AND NEW.location_reference IS NOT DISTINCT FROM OLD.location_reference
     AND NEW.classification IS NOT DISTINCT FROM OLD.classification
     AND NEW.podium_area IS NOT DISTINCT FROM OLD.podium_area
     AND NEW.issue_no IS NOT DISTINCT FROM OLD.issue_no
     AND NEW.subcontractor_issue_no IS NOT DISTINCT FROM OLD.subcontractor_issue_no
     AND NEW.subcontractor_issue_source IS NOT DISTINCT FROM OLD.subcontractor_issue_source
     AND NEW.main_trade IS NOT DISTINCT FROM OLD.main_trade
     AND NEW.sub_trade IS NOT DISTINCT FROM OLD.sub_trade
     AND NEW.trade_detail IS NOT DISTINCT FROM OLD.trade_detail
     AND NEW.area_type IS NOT DISTINCT FROM OLD.area_type
     AND NEW.area_level IS NOT DISTINCT FROM OLD.area_level
     AND NEW.area_location IS NOT DISTINCT FROM OLD.area_location
     AND NEW.subcontractor_name IS NOT DISTINCT FROM OLD.subcontractor_name
     AND NEW.subsub_name IS NOT DISTINCT FROM OLD.subsub_name
     AND NEW.hdec_pic_name IS NOT DISTINCT FROM OLD.hdec_pic_name
     AND NEW.hdec_eng_name IS NOT DISTINCT FROM OLD.hdec_eng_name
     AND NEW.captured_by_name IS NOT DISTINCT FROM OLD.captured_by_name
     AND NEW.work_type IS NOT DISTINCT FROM OLD.work_type
     AND NEW.classification_source IS NOT DISTINCT FROM OLD.classification_source
     AND NEW.classified_at IS NOT DISTINCT FROM OLD.classified_at
     AND NEW.planned_start_date IS NOT DISTINCT FROM OLD.planned_start_date
     AND NEW.planned_rectified_date IS NOT DISTINCT FROM OLD.planned_rectified_date
     AND NEW.planned_closure_date IS NOT DISTINCT FROM OLD.planned_closure_date
     AND NEW.actual_start_date IS NOT DISTINCT FROM OLD.actual_start_date
     AND NEW.actual_rectified_date IS NOT DISTINCT FROM OLD.actual_rectified_date
     AND NEW.actual_closure_date IS NOT DISTINCT FROM OLD.actual_closure_date
     AND NEW.planned_progress_pct IS NOT DISTINCT FROM OLD.planned_progress_pct
     AND NEW.actual_progress_pct IS NOT DISTINCT FROM OLD.actual_progress_pct
     AND NEW.rectified_status IS NOT DISTINCT FROM OLD.rectified_status
     AND NEW.closure_status IS NOT DISTINCT FROM OLD.closure_status
     AND NEW.status_manual IS NOT DISTINCT FROM OLD.status_manual
     AND NEW.hdec_verification IS NOT DISTINCT FROM OLD.hdec_verification
     AND NEW.hdec_reason IS NOT DISTINCT FROM OLD.hdec_reason
     AND NEW.hdec_comments IS NOT DISTINCT FROM OLD.hdec_comments
     AND NEW.aconex_comments IS NOT DISTINCT FROM OLD.aconex_comments
     AND NEW.remarks IS NOT DISTINCT FROM OLD.remarks
     AND NEW.priority_locked IS NOT DISTINCT FROM OLD.priority_locked
     AND NEW.hdec_verification_locked IS NOT DISTINCT FROM OLD.hdec_verification_locked
     AND NEW.is_critical IS NOT DISTINCT FROM OLD.is_critical
     AND NEW.status_group IS NOT DISTINCT FROM OLD.status_group
     AND NEW.building IS NOT DISTINCT FROM OLD.building
     AND NEW.room IS NOT DISTINCT FROM OLD.room
     AND NEW.room_group IS NOT DISTINCT FROM OLD.room_group
     AND NEW.level_name IS NOT DISTINCT FROM OLD.level_name
     AND NEW.review_flag IS NOT DISTINCT FROM OLD.review_flag
     AND NEW.custom_payload IS NOT DISTINCT FROM OLD.custom_payload
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_defect_history_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  src text;
  uid uuid;
BEGIN
  BEGIN
    src := coalesce(current_setting('app.change_source', true), 'manual');
  EXCEPTION WHEN others THEN src := 'manual';
  END;
  BEGIN
    uid := nullif(current_setting('app.change_user', true), '')::uuid;
  EXCEPTION WHEN others THEN uid := null;
  END;

  IF new.status_raw IS DISTINCT FROM old.status_raw THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'status_raw', old.status_raw, new.status_raw, src, uid);
  END IF;
  IF new.priority IS DISTINCT FROM old.priority THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'priority', old.priority, new.priority, src, uid);
  END IF;
  IF new.hdec_verification IS DISTINCT FROM old.hdec_verification THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'hdec_verification', old.hdec_verification, new.hdec_verification, src, uid);
  END IF;
  IF new.hdec_reason IS DISTINCT FROM old.hdec_reason THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'hdec_reason', old.hdec_reason, new.hdec_reason, src, uid);
  END IF;
  IF new.status_manual IS DISTINCT FROM old.status_manual THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'status_manual', old.status_manual, new.status_manual, src, uid);
  END IF;
  IF new.actual_progress_pct IS DISTINCT FROM old.actual_progress_pct THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_progress_pct', old.actual_progress_pct::text, new.actual_progress_pct::text, src, uid);
  END IF;
  IF new.planned_start_date IS DISTINCT FROM old.planned_start_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'planned_start_date', old.planned_start_date::text, new.planned_start_date::text, src, uid);
  END IF;
  IF new.planned_rectified_date IS DISTINCT FROM old.planned_rectified_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'planned_rectified_date', old.planned_rectified_date::text, new.planned_rectified_date::text, src, uid);
  END IF;
  IF new.planned_closure_date IS DISTINCT FROM old.planned_closure_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'planned_closure_date', old.planned_closure_date::text, new.planned_closure_date::text, src, uid);
  END IF;
  IF new.actual_start_date IS DISTINCT FROM old.actual_start_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_start_date', old.actual_start_date::text, new.actual_start_date::text, src, uid);
  END IF;
  IF new.actual_rectified_date IS DISTINCT FROM old.actual_rectified_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_rectified_date', old.actual_rectified_date::text, new.actual_rectified_date::text, src, uid);
  END IF;
  IF new.actual_closure_date IS DISTINCT FROM old.actual_closure_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_closure_date', old.actual_closure_date::text, new.actual_closure_date::text, src, uid);
  END IF;
  IF new.subcontractor_name IS DISTINCT FROM old.subcontractor_name THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'subcontractor_name', old.subcontractor_name, new.subcontractor_name, src, uid);
  END IF;
  IF new.hdec_pic_name IS DISTINCT FROM old.hdec_pic_name THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'hdec_pic_name', old.hdec_pic_name, new.hdec_pic_name, src, uid);
  END IF;
  RETURN new;
END;
$function$;

-- 3) Backfill status values
UPDATE public.defect_items_raw SET rectified_status = 'Rectified' WHERE rectified_status = 'Complete';

-- 4) Field config & header mappings
UPDATE public.defect_field_config SET field_name = 'rectified_status' WHERE field_name = 'completion_status';
UPDATE public.defect_field_config SET field_name = 'planned_rectified_date' WHERE field_name = 'planned_completion_date';
UPDATE public.defect_field_config SET field_name = 'actual_rectified_date' WHERE field_name = 'actual_completion_date';

UPDATE public.defect_header_mappings SET target_field = 'rectified_status' WHERE target_field = 'completion_status';
UPDATE public.defect_header_mappings SET target_field = 'planned_rectified_date' WHERE target_field = 'planned_completion_date';
UPDATE public.defect_header_mappings SET target_field = 'actual_rectified_date' WHERE target_field = 'actual_completion_date';

-- 5) Stage helpers (accept both 'rectified' and legacy 'completion')
CREATE OR REPLACE FUNCTION public._snag_stage_actual_date(_row public.defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'start' THEN _row.actual_start_date
    WHEN 'rectified' THEN _row.actual_rectified_date
    WHEN 'completion' THEN _row.actual_rectified_date
    WHEN 'closure' THEN _row.actual_closure_date
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_planned_date(_row public.defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'start' THEN _row.planned_start_date
    WHEN 'rectified' THEN _row.planned_rectified_date
    WHEN 'completion' THEN _row.planned_rectified_date
    WHEN 'closure' THEN _row.planned_closure_date
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_done(_row public.defect_items_raw, _stage text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'closure' THEN _row.actual_closure_date IS NOT NULL
    WHEN 'rectified' THEN
      _row.actual_rectified_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR public._snag_progress_norm(_row.actual_progress_pct) >= 100
    WHEN 'completion' THEN
      _row.actual_rectified_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR public._snag_progress_norm(_row.actual_progress_pct) >= 100
    WHEN 'start' THEN
      _row.actual_start_date IS NOT NULL
      OR _row.actual_rectified_date IS NOT NULL
      OR _row.actual_closure_date IS NOT NULL
      OR public._snag_progress_norm(_row.actual_progress_pct) > 0
    ELSE false
  END
$$;

-- 6) Progress cells / totals
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'subcontractor_name' THEN r.subcontractor_name
          WHEN 'subsub_name' THEN r.subsub_name
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'area_level' THEN r.area_level
          WHEN 'main_trade' THEN r.main_trade
          WHEN 'sub_trade' THEN r.sub_trade
          WHEN 'work_type' THEN r.work_type
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r.planned_start_date       AS psd,
      r.planned_rectified_date   AS pcd,
      r.planned_closure_date     AS pxd,
      r.actual_start_date        AS asd,
      r.actual_rectified_date    AS acd,
      r.actual_closure_date      AS axd,
      COALESCE(CASE WHEN r.actual_progress_pct > 1 THEN r.actual_progress_pct ELSE r.actual_progress_pct * 100 END, 0) AS pnorm
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND r.status_group = 'unclosed'
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (
        _room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A')
           = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x)
      )
  ),
  stage_expand AS (
    SELECT gk, 'start'::text AS stage, psd AS pdate, asd AS adate,
      (asd IS NOT NULL AND asd <= _as_of_date
       AND (asd IS NOT NULL OR acd IS NOT NULL OR axd IS NOT NULL OR pnorm > 0)) AS done_asof
    FROM base
    UNION ALL
    SELECT gk, 'rectified', pcd, acd,
      (acd IS NOT NULL AND acd <= _as_of_date
       AND (acd IS NOT NULL OR axd IS NOT NULL OR pnorm >= 100))
    FROM base
    UNION ALL
    SELECT gk, 'closure', pxd, axd,
      (axd IS NOT NULL AND axd <= _as_of_date)
    FROM base
  ),
  events AS (
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso,
      stage, 1 AS p, 0 AS a
    FROM stage_expand
    WHERE pdate IS NOT NULL AND pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode = 'baseline' OR NOT done_asof)
    UNION ALL
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', adate)::date ELSE adate END,
      stage, 0, 1
    FROM stage_expand
    WHERE adate IS NOT NULL AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events
  GROUP BY 1, 2, 3
$$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'subcontractor_name' THEN r.subcontractor_name
          WHEN 'subsub_name' THEN r.subsub_name
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'area_level' THEN r.area_level
          WHEN 'main_trade' THEN r.main_trade
          WHEN 'sub_trade' THEN r.sub_trade
          WHEN 'work_type' THEN r.work_type
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r.planned_start_date       AS psd,
      r.planned_rectified_date   AS pcd,
      r.planned_closure_date     AS pxd,
      r.actual_start_date        AS asd,
      r.actual_rectified_date    AS acd,
      r.actual_closure_date      AS axd,
      COALESCE(CASE WHEN r.actual_progress_pct > 1 THEN r.actual_progress_pct ELSE r.actual_progress_pct * 100 END, 0) AS pnorm
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND r.status_group = 'unclosed'
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (
        _room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A')
           = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x)
      )
  ),
  stage_expand AS (
    SELECT gk, 'start'::text AS stage, psd AS pdate, asd AS adate,
      (asd IS NOT NULL AND asd <= _as_of_date
       AND (asd IS NOT NULL OR acd IS NOT NULL OR axd IS NOT NULL OR pnorm > 0)) AS done_asof
    FROM base
    UNION ALL
    SELECT gk, 'rectified', pcd, acd,
      (acd IS NOT NULL AND acd <= _as_of_date
       AND (acd IS NOT NULL OR axd IS NOT NULL OR pnorm >= 100))
    FROM base
    UNION ALL
    SELECT gk, 'closure', pxd, axd,
      (axd IS NOT NULL AND axd <= _as_of_date)
    FROM base
  )
  SELECT
    gk, stage,
    count(*)::int AS total,
    count(*) FILTER (WHERE done_asof)::int AS done_upto,
    count(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND (_plan_mode = 'baseline' OR NOT done_asof))::int AS plan_upto,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int AS actual_upto
  FROM stage_expand
  GROUP BY gk, stage
$$;

-- 7) Facets: swap allowed columns
CREATE OR REPLACE FUNCTION public.defect_items_facets(_column text, _status_group text DEFAULT 'unclosed'::text, _include_inactive boolean DEFAULT false)
RETURNS TABLE(value text, cnt bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
declare
  _allowed_cols constant text[] := array[
    'team','status_raw','rectified_status','closure_status','priority','hdec_verification',
    'classification','category','defect_type','area_type','area_level','area_location',
    'main_trade','sub_trade','work_type','subcontractor_name','subsub_name','hdec_pic_name',
    'hdec_eng_name','plan_title','plan_group','created_by_name','created_by_team_name',
    'assigned_to','classification_source','item','captured_by_name','subcontractor_issue_no',
    'subcontractor_issue_source','area_raw','trade_detail','aconex_comments','hdec_reason'
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

-- 8) Search: swap allowed columns
CREATE OR REPLACE FUNCTION public.defect_items_search(_status_group text DEFAULT 'unclosed'::text, _include_inactive boolean DEFAULT false, _q text DEFAULT NULL::text, _filters jsonb DEFAULT '[]'::jsonb, _sort jsonb DEFAULT '[]'::jsonb, _offset integer DEFAULT 0, _limit integer DEFAULT 100)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
declare
  _allowed_cols constant text[] := array[
    'id','source_issue_no','team','status_raw','status_group','rectified_status','closure_status',
    'priority','hdec_verification','hdec_reason','classification','category','defect_type','item',
    'description','location_raw','area_type','area_level','area_location','location_reference',
    'plan_title','plan_group','main_trade','sub_trade','work_type','assigned_to','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','created_by_name','created_by_team_name',
    'created_date','due_by','planned_start_date','planned_rectified_date','planned_closure_date',
    'actual_start_date','actual_rectified_date','actual_closure_date','planned_progress_pct',
    'actual_progress_pct','last_updated_at','remarks','hdec_comments','is_critical','data_date',
    'is_active','captured_by_name','classification_source','subcontractor_issue_no','subcontractor_issue_source',
    'area_raw','trade_detail','aconex_comments','updated_at','created_at','classified_at',
    'building','room_group','level_name'
  ];
  _search_cols constant text[] := array[
    'source_issue_no','subcontractor_issue_no','subcontractor_issue_source','team','area_type','area_level',
    'area_location','location_raw','area_raw','main_trade','sub_trade','work_type','classification_source',
    'trade_detail','description','defect_type','status_raw','rectified_status','priority','subcontractor_name',
    'subsub_name','hdec_pic_name','hdec_eng_name','captured_by_name','closure_status','remarks','hdec_comments',
    'aconex_comments','item','assigned_to','created_by_name','plan_title'
  ];
  _sort_sql text := '';
  _where_sql text := 'true';
  _sql text;
  _filter jsonb;
  _sort_item jsonb;
  _col text;
  _op text;
  _val jsonb;
  _first_sort boolean := true;
  _token text;
  _field_sql text;
  _search_field text;
begin
  if _status_group in ('unclosed','closed') then
    _where_sql := _where_sql || format(' and status_group = %L', _status_group);
  end if;
  if not _include_inactive then
    _where_sql := _where_sql || ' and is_active = true';
  end if;

  if _q is not null and length(trim(_q)) > 0 then
    for _token in
      select trim(x) from regexp_split_to_table(_q, ',') as x where length(trim(x)) > 0
    loop
      _field_sql := '';
      foreach _search_field in array _search_cols loop
        if _field_sql <> '' then _field_sql := _field_sql || ' or '; end if;
        _field_sql := _field_sql || format('%I::text ilike %L', _search_field, '%' || _token || '%');
      end loop;
      if _field_sql <> '' then
        _where_sql := _where_sql || format(' and (%s)', _field_sql);
      end if;
    end loop;
  end if;

  for _filter in select * from jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) loop
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;

    if _op = 'in' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))',
          _col, _val
        );
      end if;
    elsif _op = 'in_or_empty' then
      if jsonb_typeof(_val) = 'array' and jsonb_array_length(_val) > 0 then
        _where_sql := _where_sql || format(
          ' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')',
          _col, _val, _col, _col
        );
      else
        _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
      end if;
    elsif _op = 'text' then
      if jsonb_typeof(_val) = 'string' then
        for _token in
          select trim(x) from regexp_split_to_table(_val #>> '{}', ',') as x where length(trim(x)) > 0
        loop
          _where_sql := _where_sql || format(' and %I::text ilike %L', _col, '%' || _token || '%');
        end loop;
      end if;
    elsif _op = 'empty' then
      _where_sql := _where_sql || format(' and (%I is null or %I::text = '''')', _col, _col);
    elsif _op = 'date_range' then
      if _val ? 'from' and length(coalesce(_val->>'from','')) > 0 then
        _where_sql := _where_sql || format(' and %I >= %L::date', _col, _val->>'from');
      end if;
      if _val ? 'to' and length(coalesce(_val->>'to','')) > 0 then
        _where_sql := _where_sql || format(' and %I <= %L::date', _col, _val->>'to');
      end if;
    elsif _op = 'num_range' then
      if _val ? 'min' then
        _where_sql := _where_sql || format(' and %I >= %s', _col, _val->>'min');
      end if;
      if _val ? 'max' then
        _where_sql := _where_sql || format(' and %I <= %s', _col, _val->>'max');
      end if;
    elsif _op = 'bool' then
      if jsonb_typeof(_val) = 'boolean' then
        _where_sql := _where_sql || format(' and %I = %L', _col, (_val::text)::boolean);
      end if;
    end if;
  end loop;

  for _sort_item in select * from jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) loop
    _col := _sort_item->>'column';
    if _col is null or not (_col = any(_allowed_cols)) then continue; end if;
    if not _first_sort then _sort_sql := _sort_sql || ', '; end if;
    _sort_sql := _sort_sql || format('%I %s nulls last', _col,
      case when coalesce((_sort_item->>'desc')::boolean, false) then 'desc' else 'asc' end);
    _first_sort := false;
  end loop;
  if _sort_sql = '' then _sort_sql := 'source_issue_no asc'; end if;

  _sql := format($fmt$
    with base as (
      select * from public.defect_items_raw where %s
    ),
    counted as (
      select count(*) over () as total_count, to_jsonb(t.*) as rows, t.*
      from base t
      order by %s
      offset %s limit %s
    )
    select rows, total_count from counted
  $fmt$, _where_sql, _sort_sql, _offset, _limit);

  return query execute _sql;
end;
$function$;
