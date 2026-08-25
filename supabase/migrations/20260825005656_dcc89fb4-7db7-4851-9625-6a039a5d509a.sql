-- 1) 복원 준비 작업: 검산 결과 전용 칸 (preflight_result 보존)
ALTER TABLE public.restore_runs ADD COLUMN IF NOT EXISTS staging_verify jsonb;

-- 2) 백업 정본 목록에 영구 기록 표 7개 추가
CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT ARRAY[
    'abd_items_raw','defect_items_raw','task_management_raw','dmr_entries',
    'profiles','user_roles','team_master','subcontractor_master','dmr_contractor_master','dmr_system_master','defect_category_team_map',
    'task_management_settings','abd_field_config','defect_field_config','task_management_field_config',
    'abd_header_mappings','defect_header_mappings','task_management_header_mappings',
    'abd_import_logs','defect_import_logs','task_management_import_logs','task_schedule_change_audit',
    'abd_settings','abd_import_presets','abd_comments','abd_change_log',
    'abd_audit_log','abd_import_row_logs','abd_mf_change_log',
    'task_management_import_row_logs','tm_pic_delegations',
    'spl_import_row_logs','wrt_import_row_logs',
    'spl_items','spl_stage_catalog','spl_stage_progress','spl_change_log','spl_settings','spl_import_logs',
    'wrt_items','wrt_stage_catalog','wrt_stage_progress','wrt_change_log','wrt_settings','wrt_import_logs',
    'rcl_permissions','rcl_module_config','rcl_permissions_audit','rcl_module_config_audit',
    'hdec_eng_name_master','hdec_pic_name_master','hdec_name_propagation_log',
    'user_view_preferences','tm_alarm_settings','tm_milestone_config','tm_milestone_config_audit','tm_milestone_kinds',
    'defect_hdec_pic_rules','defect_subcon_rules','defect_import_presets',
    'task_comments','defect_comments','defect_status_history','task_management_status_history',
    'abd_ocs_import_logs','abd_ocs_comments','abd_ocs_comment_groups','abd_ocs_comment_abd_links',
    'abd_ocs_compliance','abd_ocs_attachments','abd_ocs_attachment_comment_links','abd_ocs_compliance_log',
    'abd_ocs_response_segments','abd_ocs_response_comment_links','abd_ocs_source_files','abd_ocs_number_correction_log',
    'spl_ocs_import_logs','spl_rsp_items','spl_ocs_comment_groups','spl_ocs_comments','spl_ocs_comment_spl_links',
    'spl_ocs_comment_rsp_links','spl_ocs_categories','spl_ocs_categories_mapping','spl_ocs_attachments',
    'spl_ocs_attachment_comment_links','spl_ocs_compliance','spl_ocs_compliance_log','spl_ocs_source_files',
    'spl_documents','spl_document_item_links','spl_document_pages','spl_ocs_comment_document_links'
  ]::text[];
$fn$;

-- 3) 준비 영역 검산 강화: 타입 적합성 + 복합 PK/UNIQUE/FK + 미지원 제약 명시
CREATE OR REPLACE FUNCTION public.restore_staging_verify(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  _run public.restore_runs;
  _t text;
  _pk text[];
  _cols text[];
  _notnull text[];
  _issues jsonb := '[]'::jsonb;
  _per_table jsonb := '[]'::jsonb;
  _unsupported jsonb := '[]'::jsonb;
  _staged bigint;
  _expected bigint;
  _bad bigint;
  _badcols text[];
  _fk record;
  _uq record;
  _col record;
  _sample text;
BEGIN
  SELECT * INTO _run FROM public.restore_runs WHERE id = _run_id;
  IF _run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'issues',
      jsonb_build_array(jsonb_build_object('code','RESTORE_RUN_NOT_FOUND','message','복원 준비 작업을 찾을 수 없습니다.')));
  END IF;

  FOREACH _t IN ARRAY _run.final_restore_tables LOOP
    SELECT count(*) INTO _staged FROM public.restore_staging_rows
      WHERE restore_run_id = _run_id AND table_name = _t;
    _expected := coalesce((_run.expected_rows ->> _t)::bigint, 0);

    IF _staged <> _expected THEN
      _issues := _issues || jsonb_build_array(jsonb_build_object(
        'code','STAGING_ROW_COUNT_MISMATCH','table',_t,'expected',_expected,'staged',_staged));
    END IF;

    SELECT coalesce(array_agg(att.attname ORDER BY k.ord), '{}'::text[]) INTO _pk
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE n.nspname='public' AND c.relname = _t AND con.contype='p';

    SELECT coalesce(array_agg(a.attname), '{}'::text[]),
           coalesce(array_agg(a.attname) FILTER (WHERE a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''), '{}'::text[])
      INTO _cols, _notnull
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=_t AND a.attnum>0 AND NOT a.attisdropped;

    SELECT coalesce(array_agg(DISTINCT k), '{}'::text[]) INTO _badcols
      FROM public.restore_staging_rows s, jsonb_object_keys(s.row_data) AS k
     WHERE s.restore_run_id=_run_id AND s.table_name=_t AND NOT (k = ANY(_cols));
    IF array_length(_badcols,1) > 0 THEN
      _issues := _issues || jsonb_build_array(jsonb_build_object(
        'code','STAGING_UNKNOWN_COLUMN','table',_t,'columns',to_jsonb(_badcols)));
    END IF;

    -- 3-1) 타입 적합성: JSON 문자열 표현이 실제 컬럼 타입으로 변환 가능한지 검사
    FOR _col IN
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typname, t.typcategory, t.typtype
        FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
       WHERE n.nspname='public' AND c.relname=_t AND a.attnum>0 AND NOT a.attisdropped
         AND a.attgenerated = ''
    LOOP
      -- json/jsonb 는 원형 그대로 보존되므로 검사 제외, 배열/복합 타입은 이번 단계 미지원
      IF _col.typname IN ('json','jsonb') THEN
        CONTINUE;
      ELSIF _col.typcategory IN ('A','C') THEN
        _unsupported := _unsupported || jsonb_build_array(jsonb_build_object(
          'kind','array_or_composite_column_type','table',_t,'column',_col.attname,'type',_col.typname));
        CONTINUE;
      END IF;

      EXECUTE format(
        'SELECT count(*), min(s.row_data->>%L) FROM public.restore_staging_rows s
           WHERE s.restore_run_id=$1 AND s.table_name=$2
             AND jsonb_typeof(s.row_data->%L) NOT IN (''null'')
             AND s.row_data->>%L IS NOT NULL
             AND NOT pg_input_is_valid(s.row_data->>%L, %L)',
        _col.attname, _col.attname, _col.attname, _col.attname, _col.typname)
        INTO _bad, _sample USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_TYPE_INVALID','table',_t,'column',_col.attname,
          'type',_col.typname,'count',_bad,'sample',_sample));
      END IF;
    END LOOP;

    IF array_length(_pk,1) > 0 THEN
      EXECUTE format(
        'SELECT count(*) FROM public.restore_staging_rows s WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_pk) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_PK_NULL','table',_t,'count',_bad));
      END IF;

      EXECUTE format(
        'SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM public.restore_staging_rows s
           WHERE s.restore_run_id=$1 AND s.table_name=$2 GROUP BY %s HAVING count(*)>1) d',
        (SELECT string_agg(format('s.row_data->>%L', col), ', ') FROM unnest(_pk) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_PK_DUPLICATE','table',_t,'count',_bad));
      END IF;
    END IF;

    IF array_length(_notnull,1) > 0 THEN
      EXECUTE format(
        'SELECT count(*) FROM public.restore_staging_rows s WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_notnull) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object('code','STAGING_NOT_NULL_VIOLATION','table',_t,'count',_bad));
      END IF;
    END IF;

    FOR _uq IN
      SELECT con.conname,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS cols
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE con.contype='u' AND n.nspname='public' AND c.relname=_t
    LOOP
      EXECUTE format(
        'SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM public.restore_staging_rows s
           WHERE s.restore_run_id=$1 AND s.table_name=$2 AND NOT (%s) GROUP BY %s HAVING count(*)>1) d',
        (SELECT string_agg(format('s.row_data->>%L IS NULL', col), ' OR ') FROM unnest(_uq.cols) col),
        (SELECT string_agg(format('s.row_data->>%L', col), ', ') FROM unnest(_uq.cols) col))
        INTO _bad USING _run_id, _t;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_UNIQUE_DUPLICATE','table',_t,'constraint',_uq.conname,'count',_bad));
      END IF;
    END LOOP;

    -- 3-2) FK orphan: 단일 및 복합 FK 모두 검사.
    -- 부모가 복원 대상이면 준비 영역에서, 아니면 현재 운영 값에서 확인한다.
    FOR _fk IN
      SELECT con.conname,
             pn.nspname::text AS parent_schema,
             pc.relname::text AS parent,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS ccols,
             (SELECT array_agg(att.attname ORDER BY k.ord)
                FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid=con.confrelid AND att.attnum=k.attnum) AS pcols
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_class pc ON pc.oid=con.confrelid
        JOIN pg_namespace pn ON pn.oid=pc.relnamespace
       WHERE con.contype='f' AND n.nspname='public' AND c.relname=_t
    LOOP
      IF _fk.parent_schema = 'public' AND _fk.parent = ANY(_run.final_restore_tables) THEN
        EXECUTE format(
          'SELECT count(*) FROM public.restore_staging_rows s
             WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)
               AND NOT EXISTS (SELECT 1 FROM public.restore_staging_rows p
                    WHERE p.restore_run_id=$1 AND p.table_name=$3 AND (%s))',
          (SELECT string_agg(format('s.row_data->>%L IS NOT NULL', c), ' AND ')
             FROM unnest(_fk.ccols) c),
          (SELECT string_agg(format('p.row_data->>%L = s.row_data->>%L', _fk.pcols[i], _fk.ccols[i]), ' AND ')
             FROM generate_subscripts(_fk.ccols, 1) i))
          INTO _bad USING _run_id, _t, _fk.parent;
      ELSE
        EXECUTE format(
          'SELECT count(*) FROM public.restore_staging_rows s
             WHERE s.restore_run_id=$1 AND s.table_name=$2 AND (%s)
               AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE (%s))',
          (SELECT string_agg(format('s.row_data->>%L IS NOT NULL', c), ' AND ')
             FROM unnest(_fk.ccols) c),
          _fk.parent_schema, _fk.parent,
          (SELECT string_agg(format('p.%I::text = s.row_data->>%L', _fk.pcols[i], _fk.ccols[i]), ' AND ')
             FROM generate_subscripts(_fk.ccols, 1) i))
          INTO _bad USING _run_id, _t;
      END IF;
      IF _bad > 0 THEN
        _issues := _issues || jsonb_build_array(jsonb_build_object(
          'code','STAGING_FK_ORPHAN','table',_t,'constraint',_fk.conname,
          'columns', to_jsonb(_fk.ccols),
          'parent', _fk.parent_schema || '.' || _fk.parent,'count',_bad));
      END IF;
    END LOOP;

    -- 3-3) 이번 단계에서 지원하지 않는 제약을 명시 (조용한 "완전 검증" 금지)
    _unsupported := _unsupported || coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind','check_constraint','table',_t,'constraint',con.conname))
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE con.contype='c' AND n.nspname='public' AND c.relname=_t), '[]'::jsonb);

    _unsupported := _unsupported || coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind','partial_or_expression_unique_index','table',_t,'index',ic.relname))
        FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
        JOIN pg_class ic ON ic.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=_t AND i.indisunique
         AND (i.indpred IS NOT NULL OR i.indexprs IS NOT NULL)), '[]'::jsonb);

    _per_table := _per_table || jsonb_build_array(jsonb_build_object(
      'table', _t, 'expected_rows', _expected, 'staged_rows', _staged));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(_issues) = 0,
    'run_id', _run_id,
    'tables', _per_table,
    'issues', _issues,
    'unsupported_constraints', _unsupported
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.restore_staging_verify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_staging_verify(uuid) TO service_role;