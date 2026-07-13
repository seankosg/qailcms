
-- ============================================================
-- ABD (As-Built Drawing) Submission Management
-- ============================================================

-- 1) abd_items_raw ------------------------------------------------------------
CREATE TABLE public.abd_items_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL CHECK (team IN ('mech','elec','arch')),
  plot text CHECK (plot IN ('C','D')),
  sl_no integer,
  dis text,
  service text,
  doc_ax text,
  doc_axx text,
  doc_nn1 text,
  doc_n text,
  doc_nn2 text,
  document_title text,
  abd_number text NOT NULL,
  abd_ocs_no text,
  pic text,
  r1_drafting_plan date,     r1_drafting_actual date,
  r1_submission_plan date,   r1_submission_actual date,
  r1_dar_plan date,          r1_dar_actual date,
  r2_drafting_plan date,     r2_drafting_actual date,
  r2_submission_plan date,   r2_submission_actual date,
  r2_dar_plan date,          r2_dar_actual date,
  r3_drafting_plan date,     r3_drafting_actual date,
  r3_submission_plan date,   r3_submission_actual date,
  r3_dar_plan date,          r3_dar_actual date,
  latest_rev text,
  latest_status text,
  approval_date date,
  is_active boolean NOT NULL DEFAULT true,
  inactive_reason text,
  field_mismatch boolean NOT NULL DEFAULT false,
  mismatch_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_import_log_id uuid,
  data_date date,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  status_group text GENERATED ALWAYS AS (
    CASE
      WHEN upper(coalesce(latest_status,'')) = 'A' THEN 'approved'
      WHEN upper(coalesce(latest_status,'')) IN ('B','C') THEN 'in_progress'
      ELSE 'not_started'
    END
  ) STORED,
  CONSTRAINT abd_items_team_abd_number_key UNIQUE (team, abd_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_items_raw TO authenticated;
GRANT ALL ON public.abd_items_raw TO service_role;

ALTER TABLE public.abd_items_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_items_select" ON public.abd_items_raw FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_items_insert" ON public.abd_items_raw FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "abd_items_update" ON public.abd_items_raw FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "abd_items_admin_delete" ON public.abd_items_raw FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

CREATE INDEX abd_items_team_idx ON public.abd_items_raw (team);
CREATE INDEX abd_items_plot_idx ON public.abd_items_raw (plot);
CREATE INDEX abd_items_status_group_idx ON public.abd_items_raw (status_group);
CREATE INDEX abd_items_active_idx ON public.abd_items_raw (is_active);
CREATE INDEX abd_items_abd_number_idx ON public.abd_items_raw (abd_number);
CREATE INDEX abd_items_source_import_idx ON public.abd_items_raw (source_import_log_id);

CREATE TRIGGER trg_abd_items_updated_at
  BEFORE UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) abd_import_logs ---------------------------------------------------------
CREATE TABLE public.abd_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  team text CHECK (team IN ('mech','elec','arch')),
  plot text,
  sheet_name text,
  total_rows integer DEFAULT 0,
  inserted integer DEFAULT 0,
  updated integer DEFAULT 0,
  inactivated integer DEFAULT 0,
  mismatched integer DEFAULT 0,
  skipped_no_key integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  imported_by uuid,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  rollback_force boolean DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_import_logs TO authenticated;
GRANT ALL ON public.abd_import_logs TO service_role;
ALTER TABLE public.abd_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_import_logs_select" ON public.abd_import_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_import_logs_insert" ON public.abd_import_logs FOR INSERT TO authenticated WITH CHECK ((imported_by = auth.uid()) OR public.is_admin_or_super(auth.uid()));
CREATE POLICY "abd_import_logs_update" ON public.abd_import_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "abd_import_logs_admin_delete" ON public.abd_import_logs FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_abd_import_logs_updated_at
  BEFORE UPDATE ON public.abd_import_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) abd_change_log ---------------------------------------------------------
CREATE TABLE public.abd_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abd_item_id uuid REFERENCES public.abd_items_raw(id) ON DELETE CASCADE,
  team text,
  abd_number text,
  field text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'manual',
  upload_id uuid,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.abd_change_log TO authenticated;
GRANT ALL ON public.abd_change_log TO service_role;
ALTER TABLE public.abd_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_change_log_select" ON public.abd_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_change_log_insert" ON public.abd_change_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "abd_change_log_admin_delete" ON public.abd_change_log FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));

CREATE INDEX abd_change_log_item_idx ON public.abd_change_log (abd_item_id);
CREATE INDEX abd_change_log_upload_idx ON public.abd_change_log (upload_id);

-- Trigger: log key field changes on UPDATE
CREATE OR REPLACE FUNCTION public.trg_abd_change_log_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src text; uid uuid;
  f text;
  old_v text; new_v text;
  fields text[] := ARRAY[
    'pic','document_title','latest_rev','latest_status','approval_date',
    'r1_drafting_plan','r1_drafting_actual','r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_drafting_plan','r2_drafting_actual','r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_drafting_plan','r3_drafting_actual','r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'is_active'
  ];
BEGIN
  BEGIN src := coalesce(current_setting('app.change_source', true), 'manual'); EXCEPTION WHEN others THEN src := 'manual'; END;
  BEGIN uid := nullif(current_setting('app.change_user', true), '')::uuid; EXCEPTION WHEN others THEN uid := null; END;

  FOREACH f IN ARRAY fields LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO old_v, new_v USING OLD, NEW;
    IF old_v IS DISTINCT FROM new_v THEN
      INSERT INTO public.abd_change_log(abd_item_id, team, abd_number, field, old_value, new_value, source, changed_by, upload_id)
      VALUES (NEW.id, NEW.team, NEW.abd_number, f, old_v, new_v, src, uid,
              CASE WHEN src = 'import' THEN NEW.source_import_log_id ELSE null END);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_abd_change_log
  AFTER UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.trg_abd_change_log_fn();

-- 4) abd_header_mappings / abd_field_config -----------------------------------
CREATE TABLE public.abd_header_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL,
  source_header text NOT NULL,
  target_field text NOT NULL,
  round_index int,
  stage text,
  plan_or_actual text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_header_mappings TO authenticated;
GRANT ALL ON public.abd_header_mappings TO service_role;
ALTER TABLE public.abd_header_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abd_header_mappings_select" ON public.abd_header_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_header_mappings_admin_write" ON public.abd_header_mappings FOR ALL TO authenticated USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE TRIGGER trg_abd_header_mappings_updated_at BEFORE UPDATE ON public.abd_header_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.abd_field_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key text NOT NULL UNIQUE,
  label text NOT NULL,
  "group" text,
  data_type text NOT NULL DEFAULT 'text',
  editable boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  options jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_field_config TO authenticated;
GRANT ALL ON public.abd_field_config TO service_role;
ALTER TABLE public.abd_field_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abd_field_config_select" ON public.abd_field_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_field_config_admin_write" ON public.abd_field_config FOR ALL TO authenticated USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE TRIGGER trg_abd_field_config_updated_at BEFORE UPDATE ON public.abd_field_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Search / facets / counts RPCs -------------------------------------------
CREATE OR REPLACE FUNCTION public.abd_items_search(
  _team text DEFAULT NULL,
  _status_group text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _q text DEFAULT NULL,
  _filters jsonb DEFAULT '[]'::jsonb,
  _sort jsonb DEFAULT '[]'::jsonb,
  _offset integer DEFAULT 0,
  _limit integer DEFAULT 100
)
RETURNS TABLE(rows jsonb, total_count bigint)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _allowed_cols constant text[] := ARRAY[
    'id','team','plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','pic',
    'r1_drafting_plan','r1_drafting_actual','r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_drafting_plan','r2_drafting_actual','r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_drafting_plan','r3_drafting_actual','r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'latest_rev','latest_status','approval_date','status_group','is_active','field_mismatch','data_date','updated_at','created_at'
  ];
  _search_cols constant text[] := ARRAY[
    'abd_number','abd_ocs_no','document_title','pic','dis','service','plot','latest_rev','latest_status',
    'doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2'
  ];
  _where text := 'true';
  _sort_sql text := '';
  _first boolean := true;
  _filter jsonb; _sort_item jsonb; _col text; _op text; _val jsonb;
  _token text; _field_sql text; _sf text; _sql text;
BEGIN
  IF _team IS NOT NULL AND _team <> '' THEN
    _where := _where || format(' and team = %L', _team);
  END IF;
  IF _status_group IN ('approved','in_progress','not_started') THEN
    _where := _where || format(' and status_group = %L', _status_group);
  END IF;
  IF NOT _include_inactive THEN
    _where := _where || ' and is_active = true';
  END IF;

  IF _q IS NOT NULL AND length(trim(_q)) > 0 THEN
    FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_q, ',') AS x WHERE length(trim(x)) > 0 LOOP
      _field_sql := '';
      FOREACH _sf IN ARRAY _search_cols LOOP
        IF _field_sql <> '' THEN _field_sql := _field_sql || ' or '; END IF;
        _field_sql := _field_sql || format('%I::text ilike %L', _sf, '%' || _token || '%');
      END LOOP;
      _where := _where || format(' and (%s)', _field_sql);
    END LOOP;
  END IF;

  FOR _filter IN SELECT * FROM jsonb_array_elements(coalesce(_filters, '[]'::jsonb)) LOOP
    _col := _filter->>'column';
    _op  := coalesce(_filter->>'op', 'in');
    _val := _filter->'value';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;

    IF _op = 'in' THEN
      IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        _where := _where || format(' and %I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', _col, _val);
      END IF;
    ELSIF _op = 'in_or_empty' THEN
      IF jsonb_typeof(_val) = 'array' AND jsonb_array_length(_val) > 0 THEN
        _where := _where || format(' and (%I::text = any(array(select jsonb_array_elements_text(%L::jsonb))) or %I is null or %I::text = '''')', _col, _val, _col, _col);
      ELSE
        _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
      END IF;
    ELSIF _op = 'text' THEN
      IF jsonb_typeof(_val) = 'string' THEN
        FOR _token IN SELECT trim(x) FROM regexp_split_to_table(_val #>> '{}', ',') AS x WHERE length(trim(x)) > 0 LOOP
          _where := _where || format(' and %I::text ilike %L', _col, '%' || _token || '%');
        END LOOP;
      END IF;
    ELSIF _op = 'empty' THEN
      _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
    ELSIF _op = 'date_range' THEN
      IF _val ? 'emptyOnly' AND coalesce((_val->>'emptyOnly')::boolean, false) THEN
        _where := _where || format(' and (%I is null or %I::text = '''')', _col, _col);
      ELSE
        IF _val ? 'from' AND length(coalesce(_val->>'from','')) > 0 THEN
          _where := _where || format(' and %I::date >= %L::date', _col, _val->>'from');
        END IF;
        IF _val ? 'to' AND length(coalesce(_val->>'to','')) > 0 THEN
          _where := _where || format(' and %I::date <= %L::date', _col, _val->>'to');
        END IF;
      END IF;
    ELSIF _op = 'num_range' THEN
      IF _val ? 'min' THEN _where := _where || format(' and %I::numeric >= %L::numeric', _col, _val->>'min'); END IF;
      IF _val ? 'max' THEN _where := _where || format(' and %I::numeric <= %L::numeric', _col, _val->>'max'); END IF;
    ELSIF _op = 'bool' THEN
      _where := _where || format(' and %I = %L::boolean', _col, _val #>> '{}');
    END IF;
  END LOOP;

  FOR _sort_item IN SELECT * FROM jsonb_array_elements(coalesce(_sort, '[]'::jsonb)) LOOP
    _col := _sort_item->>'column';
    IF _col IS NULL OR NOT (_col = ANY(_allowed_cols)) THEN CONTINUE; END IF;
    IF _first THEN
      _sort_sql := format(' order by %I %s nulls last', _col, CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'desc' ELSE 'asc' END);
      _first := false;
    ELSE
      _sort_sql := _sort_sql || format(', %I %s nulls last', _col, CASE WHEN coalesce((_sort_item->>'desc')::boolean, false) THEN 'desc' ELSE 'asc' END);
    END IF;
  END LOOP;
  IF _first THEN _sort_sql := ' order by team asc, plot asc, sl_no asc nulls last'; END IF;

  _sql := format(
    'select to_jsonb(t) as rows, count(*) over () as total_count
       from public.abd_items_raw t
      where %s %s
      offset %L limit %L',
    _where, _sort_sql, greatest(_offset, 0), least(coalesce(_limit,100), 2000)
  );
  RETURN QUERY EXECUTE _sql;
END $$;

CREATE OR REPLACE FUNCTION public.abd_items_facets(_column text, _team text DEFAULT NULL, _status_group text DEFAULT NULL, _include_inactive boolean DEFAULT false)
RETURNS TABLE(value text, cnt bigint) LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _allowed constant text[] := ARRAY['team','plot','dis','service','pic','latest_rev','latest_status','status_group','doc_ax','doc_axx'];
  _where text := 'true'; _sql text;
BEGIN
  IF NOT (_column = ANY(_allowed)) THEN RAISE EXCEPTION 'Column % not allowed', _column; END IF;
  IF _team IS NOT NULL THEN _where := _where || format(' and team = %L', _team); END IF;
  IF _status_group IS NOT NULL THEN _where := _where || format(' and status_group = %L', _status_group); END IF;
  IF NOT _include_inactive THEN _where := _where || ' and is_active = true'; END IF;
  _sql := format('select %I::text as value, count(*)::bigint as cnt from public.abd_items_raw where %s and %I is not null and %I::text <> '''' group by %I order by cnt desc, value asc limit 500',
    _column, _where, _column, _column, _column);
  RETURN QUERY EXECUTE _sql;
END $$;

CREATE OR REPLACE FUNCTION public.abd_items_counts(_team text DEFAULT NULL, _include_inactive boolean DEFAULT false)
RETURNS TABLE(approved_count bigint, in_progress_count bigint, not_started_count bigint, total_count bigint, latest_data_date text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE status_group = 'approved')::bigint,
    count(*) FILTER (WHERE status_group = 'in_progress')::bigint,
    count(*) FILTER (WHERE status_group = 'not_started')::bigint,
    count(*)::bigint,
    max(data_date)::text
  FROM public.abd_items_raw
  WHERE (_team IS NULL OR team = _team) AND (_include_inactive OR is_active = true);
$$;

-- 6) Rollback / delete batch RPCs --------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_abd_import_batch(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _deleted int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  WITH del AS (DELETE FROM public.abd_items_raw WHERE source_import_log_id = _batch_id RETURNING id)
  SELECT count(*) INTO _deleted FROM del;
  DELETE FROM public.abd_change_log WHERE upload_id = _batch_id;
  DELETE FROM public.abd_import_logs WHERE id = _batch_id;
  RETURN jsonb_build_object('deleted_rows', _deleted);
END $$;

CREATE OR REPLACE FUNCTION public.preview_rollback_abd_import(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ins int := 0; _upd int := 0; _conflict int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT count(*) INTO _ins FROM public.abd_items_raw WHERE source_import_log_id = _batch_id AND is_active = true;
  SELECT count(*) INTO _upd FROM public.abd_change_log cl
    JOIN public.abd_items_raw d ON d.id = cl.abd_item_id
   WHERE cl.upload_id = _batch_id AND cl.source = 'import'
     AND d.source_import_log_id IS DISTINCT FROM _batch_id;
  WITH bc AS (
    SELECT cl.abd_item_id, cl.field, cl.changed_at
      FROM public.abd_change_log cl
      JOIN public.abd_items_raw d ON d.id = cl.abd_item_id
     WHERE cl.upload_id = _batch_id AND cl.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
  )
  SELECT count(*) INTO _conflict FROM bc
   WHERE EXISTS (
     SELECT 1 FROM public.abd_change_log later
      WHERE later.abd_item_id = bc.abd_item_id
        AND later.field = bc.field
        AND later.changed_at > bc.changed_at
        AND later.upload_id IS DISTINCT FROM _batch_id
   );
  RETURN jsonb_build_object('insert_count', _ins, 'update_count', _upd, 'conflict_count', _conflict);
END $$;

CREATE OR REPLACE FUNCTION public.rollback_abd_import(_batch_id uuid, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid(); _restored int := 0; _deleted int := 0; _skipped int := 0;
  _rec record; _has_later boolean;
BEGIN
  IF NOT public.is_admin_or_super(_user) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.abd_import_logs WHERE id = _batch_id) THEN RAISE EXCEPTION 'Batch not found'; END IF;

  FOR _rec IN
    SELECT cl.abd_item_id, cl.field, cl.old_value, cl.changed_at
      FROM public.abd_change_log cl
      JOIN public.abd_items_raw d ON d.id = cl.abd_item_id
     WHERE cl.upload_id = _batch_id AND cl.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
     ORDER BY cl.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.abd_change_log later
       WHERE later.abd_item_id = _rec.abd_item_id
         AND later.field = _rec.field
         AND later.changed_at > _rec.changed_at
         AND later.upload_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;
    IF _has_later AND NOT _force THEN _skipped := _skipped + 1; CONTINUE; END IF;

    BEGIN
      IF _rec.field LIKE 'r_%' OR _rec.field LIKE 'r1_%' OR _rec.field LIKE 'r2_%' OR _rec.field LIKE 'r3_%' OR _rec.field = 'approval_date' THEN
        EXECUTE format('UPDATE public.abd_items_raw SET %I = NULLIF($1, '''')::date WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.abd_item_id;
      ELSIF _rec.field = 'is_active' THEN
        EXECUTE format('UPDATE public.abd_items_raw SET %I = NULLIF($1, '''')::boolean WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.abd_item_id;
      ELSE
        EXECUTE format('UPDATE public.abd_items_raw SET %I = $1 WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.abd_item_id;
      END IF;
      INSERT INTO public.abd_change_log(abd_item_id, field, old_value, new_value, source, changed_by, upload_id)
      VALUES (_rec.abd_item_id, _rec.field, NULL, _rec.old_value, 'rollback', _user, _batch_id);
      _restored := _restored + 1;
    EXCEPTION WHEN others THEN _skipped := _skipped + 1;
    END;
  END LOOP;

  WITH del AS (
    UPDATE public.abd_items_raw SET is_active = false, updated_by = _user, updated_at = now()
     WHERE source_import_log_id = _batch_id AND is_active = true
    RETURNING id
  ) SELECT count(*) INTO _deleted FROM del;

  UPDATE public.abd_import_logs
     SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = _user, rollback_force = _force,
         note = coalesce(note || E'\n','') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;

  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END $$;
