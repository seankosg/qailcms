CREATE OR REPLACE FUNCTION public.wrt_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.wrt_items%ROWTYPE;
  v_auth text; v_code text; g jsonb;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_i0 int; v_s0 int; v_c0 int;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  g := public.rcl_grants('WRT','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'WRT import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.wrt_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'WRT import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('wrt.change_source', 'hdec_import', true);
  PERFORM set_config('wrt.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages; v_c0 := v_created;
    BEGIN
      SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';

      IF NOT FOUND THEN
        IF nullif(p->>'plot','') IS NULL THEN
          RAISE EXCEPTION 'WRT import: cannot create % without plot', p->>'wrt_number';
        END IF;
        INSERT INTO public.wrt_items(wrt_number, plot, team, pic, eng, created_by, updated_by)
        VALUES (p->>'wrt_number', p->>'plot',
          nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
          auth.uid(), auth.uid())
        ON CONFLICT (wrt_number) DO NOTHING;
        v_created := v_created + 1;
        SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'WRT import: failed to create %', p->>'wrt_number';
        END IF;
      ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        IF (p->'item') ?| ARRAY['r1_response_code','r2_response_code','latest_response_code','is_final_approved','dis','service','title','plot'] THEN
          RAISE EXCEPTION 'WRT authority violation: Aconex-owned item field in HDEC patch (wrt_number=%)', p->>'wrt_number';
        END IF;
        UPDATE public.wrt_items t SET
          team = CASE WHEN p->'item' ? 'team' THEN nullif(p->'item'->>'team','') ELSE t.team END,
          pic  = CASE WHEN p->'item' ? 'pic'  THEN nullif(p->'item'->>'pic','')  ELSE t.pic END,
          eng  = CASE WHEN p->'item' ? 'eng'  THEN nullif(p->'item'->>'eng','')  ELSE t.eng END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        SELECT actual_authority INTO v_auth FROM public.wrt_stage_catalog WHERE stage_code = v_code;
        IF v_auth IS NULL THEN
          RAISE EXCEPTION 'WRT import: unknown stage_code %', v_code;
        END IF;

        v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
        v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

        INSERT INTO public.wrt_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag)
        VALUES (it.id, v_code,
          CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
          CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
          CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
          CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
          CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END,
          CASE WHEN s ? 'na_flag'     THEN coalesce((s->>'na_flag')::boolean,false) ELSE false END)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE wrt_stage_progress.plan_start END,
          actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE wrt_stage_progress.actual_start END,
          plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE wrt_stage_progress.plan_finish END,
          actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE wrt_stage_progress.actual_finish END,
          flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE wrt_stage_progress.flag_value END,
          na_flag       = CASE WHEN s ? 'na_flag'     THEN coalesce((s->>'na_flag')::boolean,false) ELSE wrt_stage_progress.na_flag END,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.wrt_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0; v_created := v_c0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'wrt_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('wrt.change_source', 'app', true);
  PERFORM set_config('wrt.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created,
    'stages_upserted', v_stages, 'rejected', v_rejected, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$function$;

CREATE OR REPLACE FUNCTION public.spl_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.spl_items%ROWTYPE;
  v_auth text; v_type text; v_code text; g jsonb;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_i0 int; v_s0 int; v_c0 int;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  g := public.rcl_grants('SPL','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'SPL import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.spl_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'SPL import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('spl.change_source', 'hdec_import', true);
  PERFORM set_config('spl.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages; v_c0 := v_created;
    BEGIN
      SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';

      IF NOT FOUND THEN
        IF nullif(p->>'plot','') IS NULL THEN
          RAISE EXCEPTION 'SPL import: cannot create % without plot', p->>'spl_number';
        END IF;
        INSERT INTO public.spl_items(spl_number, plot, team, pic, eng, pic_po, eng_po, supplier, created_by, updated_by)
        VALUES (p->>'spl_number', p->>'plot',
          nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
          nullif(p->'item'->>'pic_po',''), nullif(p->'item'->>'eng_po',''), nullif(p->'item'->>'supplier',''),
          auth.uid(), auth.uid())
        ON CONFLICT (spl_number) DO NOTHING;
        v_created := v_created + 1;
        SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SPL import: failed to create %', p->>'spl_number';
        END IF;
      ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        UPDATE public.spl_items t SET
          team    = CASE WHEN p->'item' ? 'team'     THEN nullif(p->'item'->>'team','')     ELSE t.team END,
          pic     = CASE WHEN p->'item' ? 'pic'      THEN nullif(p->'item'->>'pic','')      ELSE t.pic END,
          eng     = CASE WHEN p->'item' ? 'eng'      THEN nullif(p->'item'->>'eng','')      ELSE t.eng END,
          pic_po  = CASE WHEN p->'item' ? 'pic_po'   THEN nullif(p->'item'->>'pic_po','')   ELSE t.pic_po END,
          eng_po  = CASE WHEN p->'item' ? 'eng_po'   THEN nullif(p->'item'->>'eng_po','')   ELSE t.eng_po END,
          supplier= CASE WHEN p->'item' ? 'supplier' THEN nullif(p->'item'->>'supplier','') ELSE t.supplier END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        SELECT actual_authority, value_type INTO v_auth, v_type
          FROM public.spl_stage_catalog WHERE stage_code = v_code;
        IF v_auth IS NULL THEN
          RAISE EXCEPTION 'SPL import: unknown stage_code %', v_code;
        END IF;

        v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
        v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

        INSERT INTO public.spl_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag)
        VALUES (it.id, v_code,
          CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
          CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
          CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
          CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
          CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END,
          CASE WHEN s ? 'na_flag'     THEN coalesce((s->>'na_flag')::boolean,false) ELSE false END)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE spl_stage_progress.plan_start END,
          actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE spl_stage_progress.actual_start END,
          plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE spl_stage_progress.plan_finish END,
          actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE spl_stage_progress.actual_finish END,
          flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE spl_stage_progress.flag_value END,
          na_flag       = CASE WHEN s ? 'na_flag'     THEN coalesce((s->>'na_flag')::boolean,false) ELSE spl_stage_progress.na_flag END,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.spl_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0; v_created := v_c0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'spl_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('spl.change_source', 'app', true);
  PERFORM set_config('spl.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created,
    'stages_upserted', v_stages, 'rejected', v_rejected, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$function$;

CREATE OR REPLACE FUNCTION public.abd_aconex_apply_diffs(_batch_id uuid, _patches jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_row_count int;
  v_uid uuid := auth.uid();
  g jsonb;
  p jsonb;
  doc_no text;
  set_sql text;
  k text;
  v jsonb;
  v_allowed_fields constant text[] := ARRAY[
    'latest_status',
    'latest_rev',
    'approval_date',
    'aconex_status_raw',
    'aconex_review_status_raw',
    'aconex_date_modified',
    'r1_dar_actual',
    'r2_dar_actual',
    'r3_dar_actual',
    'r1_response_result',
    'r2_response_result',
    'r3_response_result',
    'is_terminated',
    'is_active',
    'inactive_reason'
  ];
  v_forbidden_actual_fields constant text[] := ARRAY[
    'r1_submission_actual',
    'r2_submission_actual',
    'r3_submission_actual',
    'r1_draft_start_actual',
    'r2_draft_start_actual',
    'r3_draft_start_actual',
    'r1_draft_finish_actual',
    'r2_draft_finish_actual',
    'r3_draft_finish_actual'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  g := public.rcl_grants('ABD','import');
  IF g->>'role' IS NULL OR NOT ((g->>'own')::boolean OR (g->>'own_team')::boolean OR (g->>'other_team')::boolean) THEN
    RAISE EXCEPTION 'ABD Aconex import: permission denied';
  END IF;
  IF _patches IS NULL OR jsonb_typeof(_patches) <> 'array' THEN
    RETURN 0;
  END IF;

  -- change_log trigger 가 이 세션 GUC 를 읽어 source/upload_id 를 기록
  PERFORM set_config('app.change_source', 'aconex', true);
  PERFORM set_config('app.upload_id', _batch_id::text, true);

  FOR p IN SELECT value FROM jsonb_array_elements(_patches) AS t(value)
  LOOP
    doc_no := p->>'document_no';
    IF doc_no IS NULL OR length(doc_no) = 0 THEN
      CONTINUE;
    END IF;

    set_sql := '';
    FOR k, v IN SELECT key, value FROM jsonb_each(p)
    LOOP
      IF k = 'document_no' THEN
        CONTINUE;
      END IF;

      -- Aconex 정본 범위: Draft/Submission actual 은 HDEC 파일만 쓸 수 있다.
      -- stale/legacy 번들이 금지 필드를 보내면 조용히 무시하지 않고 즉시 실패시켜 재오염을 차단한다.
      IF k = ANY(v_forbidden_actual_fields) THEN
        RAISE EXCEPTION 'forbidden Aconex field: %', k;
      END IF;

      IF NOT (k = ANY(v_allowed_fields)) THEN
        RAISE EXCEPTION 'unsupported Aconex field: %', k;
      END IF;

      IF set_sql <> '' THEN
        set_sql := set_sql || ', ';
      END IF;
      IF jsonb_typeof(v) = 'null' THEN
        set_sql := set_sql || format('%I = NULL', k);
      ELSE
        set_sql := set_sql || format('%I = %L', k, (p->>k));
      END IF;
    END LOOP;

    IF set_sql = '' THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.abd_items_raw SET %s, aconex_last_synced_at = now(), source_import_log_id = %L, updated_at = now(), updated_by = %L WHERE abd_number = %L',
      set_sql, _batch_id::text, v_uid::text, doc_no
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_updated := v_updated + v_row_count;
  END LOOP;

  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_task_management_import_batch(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _deleted int := 0;
BEGIN
  IF public.rcl_max_scope(_user,'TM','delete') IS DISTINCT FROM 'other_team' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH del AS (
    DELETE FROM public.task_management_raw WHERE source_import_log_id = _batch_id RETURNING id
  )
  SELECT count(*) INTO _deleted FROM del;

  DELETE FROM public.task_management_status_history WHERE upload_id = _batch_id;
  DELETE FROM public.task_management_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.task_management_import_logs WHERE id = _batch_id;

  RETURN jsonb_build_object('deleted_rows', _deleted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_abd_import_batch(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _deleted int := 0;
BEGIN
  IF public.rcl_max_scope(auth.uid(),'ABD','delete') IS DISTINCT FROM 'other_team' THEN RAISE EXCEPTION 'Permission denied'; END IF;
  WITH del AS (DELETE FROM public.abd_items_raw WHERE source_import_log_id = _batch_id RETURNING id)
  SELECT count(*) INTO _deleted FROM del;
  DELETE FROM public.abd_change_log WHERE upload_id = _batch_id;
  DELETE FROM public.abd_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.abd_import_logs WHERE id = _batch_id;
  RETURN jsonb_build_object('deleted_rows', _deleted);
END $function$;

CREATE OR REPLACE FUNCTION public.delete_defect_import_batch(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deleted int := 0;
BEGIN
  IF public.rcl_max_scope(auth.uid(),'SM','delete') IS DISTINCT FROM 'other_team' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH del AS (
    DELETE FROM public.defect_items_raw WHERE source_import_log_id = _batch_id RETURNING id
  )
  SELECT count(*) INTO _deleted FROM del;

  DELETE FROM public.defect_status_history WHERE upload_id = _batch_id;
  DELETE FROM public.defect_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.defect_import_logs WHERE id = _batch_id;

  RETURN jsonb_build_object('deleted_rows', _deleted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_rollback_import_batch(_batch_id uuid, _kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _owner uuid; _module text;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  _module := CASE _kind
    WHEN 'task_management' THEN 'TM'
    WHEN 'defect' THEN 'SM'
    WHEN 'abd' THEN 'ABD'
    WHEN 'spl' THEN 'SPL'
    WHEN 'wrt' THEN 'WRT'
    ELSE NULL END;
  IF _kind = 'spare_part' THEN
    IF public.is_admin_or_super(_uid) THEN RETURN true; END IF;
  ELSIF _module IS NOT NULL AND public.rcl_max_scope(_uid, _module, 'delete') = 'other_team' THEN
    RETURN true;
  END IF;
  IF _kind = 'spare_part' THEN
    SELECT executed_by INTO _owner FROM public.spare_parts_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'task_management' THEN
    SELECT imported_by INTO _owner FROM public.task_management_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'defect' THEN
    SELECT imported_by INTO _owner FROM public.defect_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'abd' THEN
    SELECT imported_by INTO _owner FROM public.abd_import_logs WHERE id = _batch_id;
  ELSE
    RETURN false;
  END IF;
  RETURN _owner IS NOT NULL AND _owner = _uid;
END $function$;