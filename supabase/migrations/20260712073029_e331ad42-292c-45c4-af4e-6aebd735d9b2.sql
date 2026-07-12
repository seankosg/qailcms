
-- ============================================================================
-- Defect Management Phase 1
-- ============================================================================

-- 1. Main raw table
CREATE TABLE IF NOT EXISTS public.defect_items_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Team / system
  team text NOT NULL CHECK (team IN ('건축','전기','설비')),
  data_date date,
  source_import_log_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,

  -- LetsBuild original 25 columns
  source_issue_no text NOT NULL,
  location_raw text,
  plan_title text,
  plan_group text,
  status_raw text,
  assigned_to text,
  category text,
  defect_type text,
  item text,
  description text,
  priority text,
  due_by date,
  created_by_name text,
  created_by_team_name text,
  created_date timestamptz,
  ir text,
  forms text,
  last_updated_at timestamptz,
  updated_description text,
  updated_by_name text,
  updated_status text,
  updated_date_raw timestamptz,
  location_reference text,
  classification text,
  podium_area text,

  -- SHAW-derived / extended
  issue_no text,
  subcontractor_issue_no text,
  subcontractor_issue_source text,
  main_trade text,
  sub_trade text,
  trade_detail text,
  area_type text,
  area_level text,
  area_location text,
  subcontractor_name text,
  subsub_name text,
  hdec_pic_name text,
  hdec_eng_name text,
  captured_by_name text,
  work_type text,
  classification_source text,
  classified_at timestamptz,
  planned_start_date date,
  planned_completion_date date,
  planned_closure_date date,
  actual_start_date date,
  actual_completion_date date,
  actual_closure_date date,
  planned_progress_pct numeric,
  actual_progress_pct numeric,
  completion_status text,
  closure_status text,
  status_manual text,
  hdec_verification text,
  hdec_reason text,
  hdec_comments text,
  aconex_comments text,
  remarks text,

  -- Locking / critical flags
  priority_locked boolean NOT NULL DEFAULT false,
  hdec_verification_locked boolean NOT NULL DEFAULT false,
  is_critical boolean NOT NULL DEFAULT false,
  critical_marked_by uuid,
  critical_marked_at timestamptz,

  -- Payloads
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CONSTRAINT defect_items_raw_source_issue_no_key UNIQUE (source_issue_no)
);

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_team ON public.defect_items_raw(team);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_import_log ON public.defect_items_raw(source_import_log_id);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_status_raw ON public.defect_items_raw(status_raw);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_area ON public.defect_items_raw(area_type, area_level, area_location);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_subcontractor ON public.defect_items_raw(subcontractor_name);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_hdec_pic ON public.defect_items_raw(hdec_pic_name);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_data_date ON public.defect_items_raw(data_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_items_raw TO authenticated;
GRANT ALL ON public.defect_items_raw TO service_role;
ALTER TABLE public.defect_items_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_raw_select_authenticated"
  ON public.defect_items_raw FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_raw_insert"
  ON public.defect_items_raw FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','user']::public.app_role[]));
CREATE POLICY "defect_raw_update"
  ON public.defect_items_raw FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','user']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','user']::public.app_role[]));
CREATE POLICY "defect_raw_delete"
  ON public.defect_items_raw FOR DELETE TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER defect_items_raw_set_updated_at
BEFORE UPDATE ON public.defect_items_raw
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Field config
CREATE TABLE IF NOT EXISTS public.defect_field_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  group_key text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_field_config TO authenticated;
GRANT ALL ON public.defect_field_config TO service_role;
ALTER TABLE public.defect_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_field_config_select"
  ON public.defect_field_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_field_config_admin_write"
  ON public.defect_field_config FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER defect_field_config_set_updated_at
BEFORE UPDATE ON public.defect_field_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Header mappings
CREATE TABLE IF NOT EXISTS public.defect_header_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL DEFAULT 'defect',
  source_header text NOT NULL,
  target_field text NOT NULL,
  is_custom boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (module, source_header)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_header_mappings TO authenticated;
GRANT ALL ON public.defect_header_mappings TO service_role;
ALTER TABLE public.defect_header_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_header_mappings_select"
  ON public.defect_header_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_header_mappings_admin_write"
  ON public.defect_header_mappings FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER defect_header_mappings_set_updated_at
BEFORE UPDATE ON public.defect_header_mappings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Import logs
CREATE TABLE IF NOT EXISTS public.defect_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  team text CHECK (team IN ('건축','전기','설비')),
  data_date date,
  sheet_name text,
  total_rows integer DEFAULT 0,
  inserted integer DEFAULT 0,
  updated integer DEFAULT 0,
  skipped integer DEFAULT 0,
  rejected integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  imported_by uuid,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  rollback_force boolean DEFAULT false,
  note text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_import_logs TO authenticated;
GRANT ALL ON public.defect_import_logs TO service_role;
ALTER TABLE public.defect_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_import_logs_select"
  ON public.defect_import_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_import_logs_insert"
  ON public.defect_import_logs FOR INSERT TO authenticated
  WITH CHECK (imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()));
CREATE POLICY "defect_import_logs_update"
  ON public.defect_import_logs FOR UPDATE TO authenticated
  USING (imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()))
  WITH CHECK (imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()));
CREATE POLICY "defect_import_logs_admin_delete"
  ON public.defect_import_logs FOR DELETE TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER defect_import_logs_set_updated_at
BEFORE UPDATE ON public.defect_import_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Row-level import logs
CREATE TABLE IF NOT EXISTS public.defect_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  raw_row_no integer,
  team text,
  source_issue_no text,
  action_taken text,
  reason_code text,
  reason_detail text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defect_import_row_logs_upload ON public.defect_import_row_logs(upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_import_row_logs TO authenticated;
GRANT ALL ON public.defect_import_row_logs TO service_role;
ALTER TABLE public.defect_import_row_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_import_row_logs_select"
  ON public.defect_import_row_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_import_row_logs_insert"
  ON public.defect_import_row_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.defect_import_logs l WHERE l.id = upload_id AND (l.imported_by = auth.uid() OR public.is_admin_or_super(auth.uid())))
  );
CREATE POLICY "defect_import_row_logs_admin_delete"
  ON public.defect_import_row_logs FOR DELETE TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

-- 6. Status history
CREATE TABLE IF NOT EXISTS public.defect_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_raw_id uuid NOT NULL,
  team text,
  source_issue_no text,
  field text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'manual',
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  upload_id uuid
);

CREATE INDEX IF NOT EXISTS idx_defect_status_history_raw_id ON public.defect_status_history(defect_raw_id);
CREATE INDEX IF NOT EXISTS idx_defect_status_history_upload ON public.defect_status_history(upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_status_history TO authenticated;
GRANT ALL ON public.defect_status_history TO service_role;
ALTER TABLE public.defect_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "defect_status_history_select"
  ON public.defect_status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_status_history_insert"
  ON public.defect_status_history FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() OR public.is_admin_or_super(auth.uid()));

-- Change history trigger for main table
CREATE OR REPLACE FUNCTION public.trg_defect_history_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  IF new.planned_completion_date IS DISTINCT FROM old.planned_completion_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'planned_completion_date', old.planned_completion_date::text, new.planned_completion_date::text, src, uid);
  END IF;
  IF new.planned_closure_date IS DISTINCT FROM old.planned_closure_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'planned_closure_date', old.planned_closure_date::text, new.planned_closure_date::text, src, uid);
  END IF;
  IF new.actual_start_date IS DISTINCT FROM old.actual_start_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_start_date', old.actual_start_date::text, new.actual_start_date::text, src, uid);
  END IF;
  IF new.actual_completion_date IS DISTINCT FROM old.actual_completion_date THEN
    INSERT INTO public.defect_status_history(defect_raw_id, team, source_issue_no, field, old_value, new_value, source, changed_by)
    VALUES (new.id, new.team, new.source_issue_no, 'actual_completion_date', old.actual_completion_date::text, new.actual_completion_date::text, src, uid);
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
$$;

CREATE TRIGGER trg_defect_items_raw_history
AFTER UPDATE ON public.defect_items_raw
FOR EACH ROW EXECUTE FUNCTION public.trg_defect_history_fn();

-- 7. Rollback / delete RPCs
CREATE OR REPLACE FUNCTION public.preview_rollback_defect_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _insert_count int := 0;
  _update_count int := 0;
  _conflict_count int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT count(*) INTO _insert_count
    FROM public.defect_items_raw
   WHERE source_import_log_id = _batch_id AND is_active = true;

  SELECT count(*) INTO _update_count
    FROM public.defect_status_history h
    JOIN public.defect_items_raw d ON d.id = h.defect_raw_id
   WHERE h.upload_id = _batch_id
     AND h.source = 'import'
     AND d.source_import_log_id IS DISTINCT FROM _batch_id;

  WITH batch_changes AS (
    SELECT h.defect_raw_id, h.field, h.changed_at
      FROM public.defect_status_history h
      JOIN public.defect_items_raw d ON d.id = h.defect_raw_id
     WHERE h.upload_id = _batch_id
       AND h.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
  )
  SELECT count(*) INTO _conflict_count
    FROM batch_changes bc
   WHERE EXISTS (
     SELECT 1 FROM public.defect_status_history later
      WHERE later.defect_raw_id = bc.defect_raw_id
        AND later.field = bc.field
        AND later.changed_at > bc.changed_at
        AND later.upload_id IS DISTINCT FROM _batch_id
   );

  RETURN jsonb_build_object(
    'insert_count', _insert_count,
    'update_count', _update_count,
    'conflict_count', _conflict_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_defect_import(_batch_id uuid, _force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _user uuid := auth.uid();
  _restored int := 0;
  _deleted int := 0;
  _skipped int := 0;
  _rec record;
  _has_later boolean;
BEGIN
  IF NOT public.is_admin_or_super(_user) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.defect_import_logs WHERE id = _batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  FOR _rec IN
    SELECT h.defect_raw_id, h.field, h.old_value, h.changed_at
      FROM public.defect_status_history h
      JOIN public.defect_items_raw d ON d.id = h.defect_raw_id
     WHERE h.upload_id = _batch_id
       AND h.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
     ORDER BY h.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.defect_status_history later
       WHERE later.defect_raw_id = _rec.defect_raw_id
         AND later.field = _rec.field
         AND later.changed_at > _rec.changed_at
         AND later.upload_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;

    IF _has_later AND NOT _force THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      IF _rec.field IN ('planned_start_date','planned_completion_date','planned_closure_date','actual_start_date','actual_completion_date','actual_closure_date','due_by') THEN
        EXECUTE format('UPDATE public.defect_items_raw SET %I = NULLIF($1, '''')::date WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.defect_raw_id;
      ELSIF _rec.field IN ('actual_progress_pct','planned_progress_pct') THEN
        EXECUTE format('UPDATE public.defect_items_raw SET %I = NULLIF($1, '''')::numeric WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.defect_raw_id;
      ELSE
        EXECUTE format('UPDATE public.defect_items_raw SET %I = $1 WHERE id = $2', _rec.field)
          USING _rec.old_value, _rec.defect_raw_id;
      END IF;

      INSERT INTO public.defect_status_history(defect_raw_id, field, old_value, new_value, source, changed_by, upload_id)
      VALUES (_rec.defect_raw_id, _rec.field, NULL, _rec.old_value, 'rollback', _user, _batch_id);

      _restored := _restored + 1;
    EXCEPTION WHEN others THEN
      _skipped := _skipped + 1;
    END;
  END LOOP;

  WITH del AS (
    UPDATE public.defect_items_raw
       SET is_active = false, updated_by = _user, updated_at = now()
     WHERE source_import_log_id = _batch_id AND is_active = true
    RETURNING id
  )
  SELECT count(*) INTO _deleted FROM del;

  UPDATE public.defect_import_logs
     SET status = 'rolled_back',
         rolled_back_at = now(),
         rolled_back_by = _user,
         rollback_force = _force,
         note = COALESCE(note || E'\n', '') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;

  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_defect_import_batch(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _deleted int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
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
$$;

-- 8. Seed field_config
INSERT INTO public.defect_field_config (field_name, display_name, is_visible, sort_order, group_key) VALUES
  ('source_issue_no',        'ID',                       true,   10, 'identity'),
  ('team',                   'Team',                     true,   20, 'identity'),
  ('status_raw',             'Status',                   true,   30, 'status'),
  ('completion_status',      'Completion Status',        true,   40, 'status'),
  ('closure_status',         'Closure Status',           true,   50, 'status'),
  ('priority',               'Priority',                 true,   60, 'classification'),
  ('hdec_verification',      'HDEC Verification',        true,   70, 'classification'),
  ('hdec_reason',            'HDEC Reason',              true,   80, 'classification'),
  ('classification',         'Classification',           true,   90, 'classification'),
  ('category',               'Category',                 true,  100, 'classification'),
  ('defect_type',            'Type',                     true,  110, 'classification'),
  ('item',                   'Item',                     true,  120, 'classification'),
  ('description',            'Description',              true,  130, 'content'),
  ('location_raw',           'Location',                 true,  140, 'location'),
  ('area_type',              'Area Type',                true,  150, 'location'),
  ('area_level',             'Area Level',               true,  160, 'location'),
  ('area_location',          'Area Location',            true,  170, 'location'),
  ('location_reference',     'Location Reference',       true,  180, 'location'),
  ('podium_area',            'Podium Area',              false, 190, 'location'),
  ('plan_title',             'Plan Title',               true,  200, 'plan'),
  ('plan_group',             'Plan Group',               true,  210, 'plan'),
  ('main_trade',             'Main Trade',               true,  220, 'trade'),
  ('sub_trade',              'Sub Trade',                true,  230, 'trade'),
  ('trade_detail',           'Trade Detail',             false, 240, 'trade'),
  ('work_type',              'Work Type',                true,  250, 'trade'),
  ('assigned_to',            'Assigned To',              true,  260, 'people'),
  ('subcontractor_name',     'Subcontractor',            true,  270, 'people'),
  ('subsub_name',            'Sub-Sub',                  true,  280, 'people'),
  ('hdec_pic_name',          'HDEC PIC',                 true,  290, 'people'),
  ('hdec_eng_name',          'HDEC ENG',                 true,  300, 'people'),
  ('captured_by_name',       'Captured By',              false, 310, 'people'),
  ('created_by_name',        'Created By',               true,  320, 'audit'),
  ('created_by_team_name',   'Created Team',             false, 330, 'audit'),
  ('created_date',           'Created Date',             true,  340, 'audit'),
  ('due_by',                 'Due By',                   true,  350, 'dates'),
  ('planned_start_date',     'Planned Start',            true,  360, 'dates'),
  ('planned_completion_date','Planned Completion',       true,  370, 'dates'),
  ('planned_closure_date',   'Planned Closure',          true,  380, 'dates'),
  ('actual_start_date',      'Actual Start',             true,  390, 'dates'),
  ('actual_completion_date', 'Actual Completion',        true,  400, 'dates'),
  ('actual_closure_date',    'Actual Closure',           true,  410, 'dates'),
  ('planned_progress_pct',   'Planned Progress %',       true,  420, 'progress'),
  ('actual_progress_pct',    'Actual Progress %',        true,  430, 'progress'),
  ('ir',                     'IR',                       false, 440, 'refs'),
  ('forms',                  'Forms',                    false, 450, 'refs'),
  ('subcontractor_issue_no', 'Subcon Issue No',          false, 460, 'refs'),
  ('last_updated_at',        'Last Updated',             true,  470, 'audit'),
  ('updated_description',    'Updated Description',      false, 480, 'audit'),
  ('updated_by_name',        'Updated By',               false, 490, 'audit'),
  ('updated_status',         'Updated Status',           false, 500, 'audit'),
  ('updated_date_raw',       'Updated Date (Raw)',       false, 510, 'audit'),
  ('remarks',                'Remarks',                  true,  520, 'content'),
  ('hdec_comments',          'HDEC Comments',            true,  530, 'content'),
  ('aconex_comments',        'Aconex Comments',          false, 540, 'content'),
  ('data_date',              'Data Date',                true,  550, 'audit'),
  ('is_critical',            'Critical',                 true,  560, 'flags')
ON CONFLICT (field_name) DO NOTHING;

-- 9. Seed header mappings (LetsBuild standard headers → target field)
INSERT INTO public.defect_header_mappings (module, source_header, target_field, is_custom, is_active) VALUES
  ('defect','ID','source_issue_no',false,true),
  ('defect','Location','location_raw',false,true),
  ('defect','PlanTitle','plan_title',false,true),
  ('defect','PlanGroup','plan_group',false,true),
  ('defect','Status','status_raw',false,true),
  ('defect','AssignedTo','assigned_to',false,true),
  ('defect','Category','category',false,true),
  ('defect','Type','defect_type',false,true),
  ('defect','Item','item',false,true),
  ('defect','Description','description',false,true),
  ('defect','Priority','priority',false,true),
  ('defect','DueBy','due_by',false,true),
  ('defect','CreatedBy','created_by_name',false,true),
  ('defect','CreatedByTeamName','created_by_team_name',false,true),
  ('defect','CreatedDate','created_date',false,true),
  ('defect','IR','ir',false,true),
  ('defect','Forms','forms',false,true),
  ('defect','LastUpdated','last_updated_at',false,true),
  ('defect','UpdatedDescription','updated_description',false,true),
  ('defect','UpdatedBy','updated_by_name',false,true),
  ('defect','UpdatedStatus','updated_status',false,true),
  ('defect','UpdatedDate','updated_date_raw',false,true),
  ('defect','LocationReference','location_reference',false,true),
  ('defect','Classification','classification',false,true),
  ('defect','Podium area','podium_area',false,true)
ON CONFLICT (module, source_header) DO NOTHING;
