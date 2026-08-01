-- ============ WRT (Warranty) Phase 1 ============

CREATE TABLE public.wrt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wrt_number text NOT NULL UNIQUE,
  plot text NOT NULL,
  team text,
  dis text,
  service text,
  title text,
  pic text,
  eng text,
  r1_response_code text,
  r1_response_code_raw text,
  r2_response_code text,
  r2_response_code_raw text,
  latest_response_code text,
  latest_status_raw text,
  is_final_approved boolean NOT NULL DEFAULT false,
  final_approved_raw text,
  response_source text NOT NULL DEFAULT 'ACONEX',
  active_round smallint GENERATED ALWAYS AS (
    CASE
      WHEN nullif(btrim(coalesce(r2_response_code,'')),'') IS NOT NULL THEN 2
      WHEN upper(btrim(coalesce(r1_response_code,''))) IN ('B','C') THEN 2
      ELSE 1
    END
  ) STORED,
  is_active boolean NOT NULL DEFAULT true,
  is_excluded boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  data_date date,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrt_items TO authenticated;
GRANT ALL ON public.wrt_items TO service_role;
ALTER TABLE public.wrt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_items_select ON public.wrt_items FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_items_write ON public.wrt_items FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));

CREATE TABLE public.wrt_stage_catalog (
  stage_code text PRIMARY KEY,
  module text NOT NULL DEFAULT 'WRT',
  band text NOT NULL,
  sort_order integer NOT NULL,
  label text NOT NULL,
  value_type text NOT NULL,
  actual_authority text NOT NULL DEFAULT 'HDEC',
  round_no smallint,
  in_progress_denominator boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wrt_stage_catalog TO authenticated;
GRANT ALL ON public.wrt_stage_catalog TO service_role;
ALTER TABLE public.wrt_stage_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_catalog_select ON public.wrt_stage_catalog FOR SELECT TO authenticated USING (true);

CREATE TABLE public.wrt_stage_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.wrt_items(id) ON DELETE CASCADE,
  stage_code text NOT NULL REFERENCES public.wrt_stage_catalog(stage_code),
  plan_start date,
  actual_start date,
  plan_finish date,
  actual_finish date,
  flag_value text,
  na_flag boolean NOT NULL DEFAULT false,
  remarks text,
  data_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (item_id, stage_code)
);
CREATE INDEX idx_wrt_progress_item ON public.wrt_stage_progress(item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrt_stage_progress TO authenticated;
GRANT ALL ON public.wrt_stage_progress TO service_role;
ALTER TABLE public.wrt_stage_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_progress_select ON public.wrt_stage_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_progress_write ON public.wrt_stage_progress FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));

CREATE TABLE public.wrt_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  item_id uuid,
  wrt_number text,
  stage_code text,
  action text NOT NULL,
  column_name text,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'app',
  batch_id uuid,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wrt_change_log_item ON public.wrt_change_log(item_id);
CREATE INDEX idx_wrt_change_log_batch ON public.wrt_change_log(batch_id);
GRANT SELECT, INSERT ON public.wrt_change_log TO authenticated;
GRANT ALL ON public.wrt_change_log TO service_role;
ALTER TABLE public.wrt_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_change_log_select ON public.wrt_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_change_log_insert ON public.wrt_change_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.wrt_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrt_settings TO authenticated;
GRANT ALL ON public.wrt_settings TO service_role;
ALTER TABLE public.wrt_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_settings_select ON public.wrt_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_settings_write ON public.wrt_settings FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));
INSERT INTO public.wrt_settings(key, value) VALUES ('delete_guard', '{"pct":5,"min_count":50}'::jsonb);

CREATE TABLE public.wrt_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  sheet_names text[] NOT NULL DEFAULT '{}',
  total_rows integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  unmatched integer NOT NULL DEFAULT 0,
  ocs_excluded integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  stages_upserted integer NOT NULL DEFAULT 0,
  cleared_values integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  note text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrt_import_logs TO authenticated;
GRANT ALL ON public.wrt_import_logs TO service_role;
ALTER TABLE public.wrt_import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_import_logs_select ON public.wrt_import_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_import_logs_write ON public.wrt_import_logs FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));

CREATE TABLE public.wrt_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.wrt_import_logs(id) ON DELETE CASCADE,
  sheet_name text,
  excel_row integer,
  wrt_number text,
  outcome text NOT NULL,
  code text,
  detail text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wrt_import_row_logs_batch ON public.wrt_import_row_logs(batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wrt_import_row_logs TO authenticated;
GRANT ALL ON public.wrt_import_row_logs TO service_role;
ALTER TABLE public.wrt_import_row_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrt_import_row_logs_select ON public.wrt_import_row_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY wrt_import_row_logs_write ON public.wrt_import_row_logs FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));

-- ---------- 13단계 카탈로그 시드 (파일 열 순서 그대로) ----------
INSERT INTO public.wrt_stage_catalog(stage_code, band, sort_order, label, value_type, actual_authority, round_no, note) VALUES
  ('REQ_SUBMISSION',    'COMMERCIAL',     10, 'Request for submission',     'single', 'HDEC',   NULL, NULL),
  ('RESPONSE_RECEIVED', 'COMMERCIAL',     20, 'Response Received',          'range',  'HDEC',   NULL, NULL),
  ('NEGOTIATION',       'COMMERCIAL',     30, 'Negotiation',                'range',  'HDEC',   NULL, NULL),
  ('CONFIRM_QUOTATION', 'COMMERCIAL',     40, 'Confirmation of Quotation',  'single', 'HDEC',   NULL, NULL),
  ('DRAFT_DOC_R1',      'DRAFT_APPROVAL', 50, 'Draft Document (R1)',        'range',  'HDEC',   1,    NULL),
  ('SUBMISSION_R1',     'DRAFT_APPROVAL', 60, 'Submission (R1)',            'range',  'HDEC',   1,    NULL),
  ('RESPONSE_DATE_R1',  'DRAFT_APPROVAL', 70, 'Response Date (R1)',         'single', 'ACONEX', 1,    'Aconex 정본. 선행/위반 판정 제외'),
  ('DRAFT_DOC_R2',      'DRAFT_APPROVAL', 80, 'Draft Document (R2)',        'range',  'HDEC',   2,    NULL),
  ('SUBMISSION_R2',     'DRAFT_APPROVAL', 90, 'Submission (R2)',            'range',  'HDEC',   2,    NULL),
  ('RESPONSE_DATE_R2',  'DRAFT_APPROVAL',100, 'Response Date (R2)',         'single', 'ACONEX', 2,    'Aconex 정본. 선행/위반 판정 제외'),
  ('DOC_PREPARATION',   'SUBMISSION',    110, 'Document Preparation',       'range',  'HDEC',   NULL, NULL),
  ('SUBCON_STAMP',      'SUBMISSION',    120, 'Subcon Stamp',               'range',  'HDEC',   NULL, NULL),
  ('FINAL_SUBMISSION',  'SUBMISSION',    130, 'Final Submission',           'range',  'HDEC',   NULL, NULL);

-- ---------- 감사/타임스탬프 트리거 ----------
CREATE OR REPLACE FUNCTION public.wrt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.wrt_audit_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  j_old jsonb; j_new jsonb; k text; ov text; nv text;
  v_item uuid; v_num text; v_stage text; v_src text; v_batch uuid;
  skip_cols text[] := ARRAY['updated_at','created_at','updated_by','created_by','id'];
BEGIN
  v_src := coalesce(current_setting('wrt.change_source', true), 'app');
  BEGIN
    v_batch := nullif(current_setting('wrt.batch_id', true), '')::uuid;
  EXCEPTION WHEN others THEN v_batch := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    j_old := to_jsonb(OLD);
    IF TG_TABLE_NAME = 'wrt_items' THEN v_item := OLD.id; v_num := j_old->>'wrt_number';
    ELSE v_item := (j_old->>'item_id')::uuid; v_stage := j_old->>'stage_code'; END IF;
    INSERT INTO public.wrt_change_log(table_name,row_id,item_id,wrt_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, v_item, v_num, v_stage, 'delete', NULL, j_old::text, NULL, v_src, v_batch, auth.uid());
    RETURN OLD;
  END IF;

  j_new := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'wrt_items' THEN v_item := NEW.id; v_num := j_new->>'wrt_number';
  ELSE v_item := (j_new->>'item_id')::uuid; v_stage := j_new->>'stage_code'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.wrt_change_log(table_name,row_id,item_id,wrt_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_item, v_num, v_stage, 'insert', NULL, NULL, j_new::text, v_src, v_batch, auth.uid());
    RETURN NEW;
  END IF;

  j_old := to_jsonb(OLD);
  FOR k IN SELECT jsonb_object_keys(j_new) LOOP
    IF k = ANY(skip_cols) THEN CONTINUE; END IF;
    ov := j_old->>k; nv := j_new->>k;
    IF ov IS DISTINCT FROM nv THEN
      INSERT INTO public.wrt_change_log(table_name,row_id,item_id,wrt_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, v_item, v_num, v_stage, 'update', k, ov, nv, v_src, v_batch, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_wrt_items_touch BEFORE UPDATE ON public.wrt_items
  FOR EACH ROW EXECUTE FUNCTION public.wrt_touch_updated_at();
CREATE TRIGGER trg_wrt_progress_touch BEFORE UPDATE ON public.wrt_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.wrt_touch_updated_at();
CREATE TRIGGER trg_wrt_import_logs_touch BEFORE UPDATE ON public.wrt_import_logs
  FOR EACH ROW EXECUTE FUNCTION public.wrt_touch_updated_at();
CREATE TRIGGER trg_wrt_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.wrt_items
  FOR EACH ROW EXECUTE FUNCTION public.wrt_audit_columns();
CREATE TRIGGER trg_wrt_progress_audit AFTER INSERT OR UPDATE OR DELETE ON public.wrt_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.wrt_audit_columns();

-- ---------- 불변식(검출형) 뷰 ----------
CREATE VIEW public.wrt_precedence_violations
WITH (security_invoker = true) AS
WITH hdec AS (
  SELECT p.item_id, p.stage_code, c.sort_order, c.label,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any
    FROM public.wrt_stage_progress p
    JOIN public.wrt_stage_catalog c ON c.stage_code = p.stage_code
   WHERE c.actual_authority = 'HDEC'
     AND c.value_type <> 'flag'
     AND c.stage_code NOT IN ('RESPONSE_DATE_R1','RESPONSE_DATE_R2')
),
prec AS (
  SELECT 'precedence'::text AS violation_type,
         h.item_id, i.wrt_number, i.plot, i.team,
         h.stage_code, h.label, h.sort_order, h.actual_any AS actual_date,
         (SELECT count(*) FROM hdec pr
           WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL) AS missing_predecessors,
         '선행 단계 실적 없이 후행 실적 존재'::text AS detail
    FROM hdec h
    JOIN public.wrt_items i ON i.id = h.item_id
   WHERE h.actual_any IS NOT NULL
     AND EXISTS (SELECT 1 FROM hdec pr
                  WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL)
),
ghost AS (
  SELECT 'ghost_round'::text AS violation_type,
         i.id AS item_id, i.wrt_number, i.plot, i.team,
         ('ROUND_' || r.n)::text AS stage_code,
         ('Response (R' || r.n || ')')::text AS label,
         (60 + (r.n - 1) * 30)::int AS sort_order,
         rd.actual_any AS actual_date,
         0::bigint AS missing_predecessors,
         '제출 실적이 없는 라운드에 회신 코드/회신일 존재'::text AS detail
    FROM public.wrt_items i
    CROSS JOIN (VALUES (1),(2)) AS r(n)
    LEFT JOIN LATERAL (
      SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
        FROM public.wrt_stage_progress p
       WHERE p.item_id = i.id AND p.stage_code = 'SUBMISSION_R' || r.n
    ) sub ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
        FROM public.wrt_stage_progress p
       WHERE p.item_id = i.id AND p.stage_code = 'RESPONSE_DATE_R' || r.n
    ) rd ON true
   WHERE sub.actual_any IS NULL
     AND (
       rd.actual_any IS NOT NULL
       OR nullif(btrim(CASE WHEN r.n = 1 THEN i.r1_response_code ELSE i.r2_response_code END), '') IS NOT NULL
     )
)
SELECT * FROM prec
UNION ALL
SELECT * FROM ghost;

GRANT SELECT ON public.wrt_precedence_violations TO authenticated;

-- ---------- 단계 상태 / 판정 / 정본 조회 ----------
CREATE OR REPLACE FUNCTION public.wrt_stage_state(
  _value_type text, _plan_start date, _plan_finish date,
  _actual_start date, _actual_finish date, _flag text, _na boolean, _as_of date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(_na, false) THEN 'na'
    WHEN _value_type = 'flag' THEN
      CASE WHEN nullif(btrim(coalesce(_flag,'')),'') IS NOT NULL THEN 'done' ELSE 'none' END
    WHEN _value_type = 'range' AND _actual_finish IS NOT NULL AND _actual_finish <= _as_of THEN 'done'
    WHEN _value_type <> 'range'
     AND coalesce(_actual_finish, _actual_start) IS NOT NULL
     AND coalesce(_actual_finish, _actual_start) <= _as_of THEN 'done'
    WHEN _actual_start IS NOT NULL AND _actual_start <= _as_of THEN
      CASE WHEN coalesce(_plan_finish, _plan_start) IS NOT NULL
             AND coalesce(_plan_finish, _plan_start) < _as_of THEN 'delayed' ELSE 'wip' END
    WHEN coalesce(_plan_finish, _plan_start) IS NOT NULL
     AND coalesce(_plan_finish, _plan_start) < _as_of THEN 'delayed'
    WHEN coalesce(_plan_start, _plan_finish) IS NOT NULL THEN 'planned'
    ELSE 'none'
  END
$$;

-- 완료의 정본 = is_final_approved (최종 승인 A). 날짜 존재는 완료 근거가 아니다.
CREATE OR REPLACE FUNCTION public.wrt_judge_v1(
  _is_final_approved boolean, _latest_response_code text, _is_excluded boolean,
  _done integer, _delayed integer, _denom integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(_is_excluded, false) THEN '제외'
    WHEN coalesce(_is_final_approved, false) THEN '완료'
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_delayed,0) > 0 THEN '지연'
    ELSE '정상'
  END
$$;

CREATE OR REPLACE FUNCTION public.wrt_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb;
  v_viol_total int; v_viol_new int; v_viol_prec int; v_viol_ghost int;
  v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'round_no', round_no, 'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.wrt_stage_catalog;

  WITH st AS (
    SELECT i.id AS item_id, c.stage_code, c.value_type, c.sort_order,
      p.na_flag, p.plan_start, p.plan_finish,
      CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END AS actual_start,
      CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END AS actual_finish,
      p.flag_value,
      public.wrt_stage_state(c.value_type, p.plan_start, p.plan_finish,
        CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END,
        CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END,
        p.flag_value, p.na_flag, v_as_of) AS state
    FROM public.wrt_items i
    CROSS JOIN public.wrt_stage_catalog c
    LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
    WHERE i.is_active
  ), agg AS (
    SELECT item_id,
      jsonb_object_agg(stage_code, jsonb_build_object(
        'ps', plan_start, 'pf', plan_finish, 'as', actual_start, 'af', actual_finish,
        'fv', flag_value, 'na', coalesce(na_flag,false), 'st', state)) AS stages,
      count(*) FILTER (WHERE state <> 'na' AND state <> 'none') AS denom,
      count(*) FILTER (WHERE state = 'done')                    AS done,
      count(*) FILTER (WHERE state = 'delayed')                 AS delayed,
      count(*) FILTER (WHERE state = 'na')                      AS na_cnt
    FROM st GROUP BY item_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'wrt_number', i.wrt_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng,
    'r1_response_code', i.r1_response_code, 'r2_response_code', i.r2_response_code,
    'latest_response_code', i.latest_response_code,
    'is_final_approved', i.is_final_approved,
    'response_source', i.response_source,
    'active_round', i.active_round,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'latest_status_raw', i.latest_status_raw,
    'data_date', i.data_date,
    'stages', coalesce(a.stages, '{}'::jsonb),
    'na_count', coalesce(a.na_cnt,0),
    'done', coalesce(a.done,0), 'delayed', coalesce(a.delayed,0),
    'denom', coalesce(a.denom,0),
    'progress_pct', CASE WHEN coalesce(a.denom,0) = 0 THEN NULL
                         ELSE round(a.done::numeric * 100 / a.denom, 1) END,
    'judgment', public.wrt_judge_v1(i.is_final_approved, i.latest_response_code, i.is_excluded,
                                    coalesce(a.done,0)::int, coalesce(a.delayed,0)::int, coalesce(a.denom,0)::int)
  ) ORDER BY i.plot, i.wrt_number)
  INTO v_rows
  FROM public.wrt_items i
  LEFT JOIN agg a ON a.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n
    FROM jsonb_array_elements(v_rows) r GROUP BY 1
  ) q;

  SELECT count(*), count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'ghost_round')
    INTO v_viol_total, v_viol_prec, v_viol_ghost
    FROM public.wrt_precedence_violations;

  SELECT id INTO v_last_batch FROM public.wrt_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_viol_new
    FROM public.wrt_precedence_violations v
   WHERE v_last_batch IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.wrt_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_total,0),
      'precedence', coalesce(v_viol_prec,0),
      'ghost_round', coalesce(v_viol_ghost,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch)
  );
END;
$$;

-- ---------- 백업 대상 목록에 WRT 등재 ----------
CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ARRAY[
    'abd_items_raw','defect_items_raw','task_management_raw','dmr_entries','profiles','user_roles',
    'team_master','subcontractor_master','dmr_contractor_master','dmr_system_master',
    'defect_category_team_map','task_management_settings','abd_field_config','defect_field_config',
    'task_management_field_config','abd_header_mappings','defect_header_mappings',
    'task_management_header_mappings','abd_import_logs','defect_import_logs',
    'task_management_import_logs','task_schedule_change_audit','abd_settings','abd_import_presets',
    'abd_comments','abd_change_log',
    'spl_items','spl_stage_catalog','spl_stage_progress','spl_change_log',
    'wrt_items','wrt_stage_catalog','wrt_stage_progress','wrt_change_log'
  ]::text[];
$$;