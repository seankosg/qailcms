-- 1) Import logs
CREATE TABLE public.spl_import_logs (
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_import_logs TO authenticated;
GRANT ALL ON public.spl_import_logs TO service_role;
ALTER TABLE public.spl_import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_import_logs_select" ON public.spl_import_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_import_logs_write" ON public.spl_import_logs TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));
CREATE TRIGGER trg_spl_import_logs_touch BEFORE UPDATE ON public.spl_import_logs
  FOR EACH ROW EXECUTE FUNCTION public.spl_touch_updated_at();

-- 2) Row-level import logs (TM 수준)
CREATE TABLE public.spl_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.spl_import_logs(id) ON DELETE CASCADE,
  sheet_name text,
  excel_row integer,
  spl_number text,
  outcome text NOT NULL,
  code text,
  detail text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_spl_import_row_logs_batch ON public.spl_import_row_logs(batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_import_row_logs TO authenticated;
GRANT ALL ON public.spl_import_row_logs TO service_role;
ALTER TABLE public.spl_import_row_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_import_row_logs_select" ON public.spl_import_row_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_import_row_logs_write" ON public.spl_import_row_logs TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));

-- 3) Settings (삭제 규모 가드)
CREATE TABLE public.spl_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_settings TO authenticated;
GRANT ALL ON public.spl_settings TO service_role;
ALTER TABLE public.spl_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_settings_select" ON public.spl_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_settings_write" ON public.spl_settings TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]));
INSERT INTO public.spl_settings(key, value) VALUES
  ('delete_guard', '{"pct": 5, "min_count": 50}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4) change_log 에 batch_id 연결
CREATE OR REPLACE FUNCTION public.spl_audit_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  j_old jsonb; j_new jsonb; k text; ov text; nv text;
  v_item uuid; v_spl text; v_stage text; v_src text; v_batch uuid;
  skip_cols text[] := ARRAY['updated_at','created_at','updated_by','created_by','id'];
BEGIN
  v_src := coalesce(current_setting('spl.change_source', true), 'app');
  BEGIN
    v_batch := nullif(current_setting('spl.batch_id', true), '')::uuid;
  EXCEPTION WHEN others THEN v_batch := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    j_old := to_jsonb(OLD);
    IF TG_TABLE_NAME = 'spl_items' THEN v_item := OLD.id; v_spl := OLD.spl_number;
    ELSE v_item := (j_old->>'item_id')::uuid; v_stage := j_old->>'stage_code'; END IF;
    INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, v_item, v_spl, v_stage, 'delete', NULL, j_old::text, NULL, v_src, v_batch, auth.uid());
    RETURN OLD;
  END IF;

  j_new := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'spl_items' THEN v_item := NEW.id; v_spl := NEW.spl_number;
  ELSE v_item := (j_new->>'item_id')::uuid; v_stage := j_new->>'stage_code'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_item, v_spl, v_stage, 'insert', NULL, NULL, j_new::text, v_src, v_batch, auth.uid());
    RETURN NEW;
  END IF;

  j_old := to_jsonb(OLD);
  FOR k IN SELECT jsonb_object_keys(j_new) LOOP
    IF k = ANY(skip_cols) THEN CONTINUE; END IF;
    ov := j_old->>k; nv := j_new->>k;
    IF ov IS DISTINCT FROM nv THEN
      INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, v_item, v_spl, v_stage, 'update', k, ov, nv, v_src, v_batch, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END; $function$;

-- 5) HDEC 임포트 반영 RPC (권위 모델 강제)
CREATE OR REPLACE FUNCTION public.spl_hdec_apply(
  _batch_id uuid,
  _patches jsonb,
  _allow_deletes boolean DEFAULT false,
  _delete_count integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p jsonb; s jsonb; it public.spl_items%ROWTYPE;
  v_auth text; v_type text; v_code text;
  v_items int := 0; v_stages int := 0;
  v_unmatched text[] := '{}';
  v_pct numeric; v_min int; v_total int;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]) THEN
    RAISE EXCEPTION 'SPL import: permission denied';
  END IF;

  -- 삭제 규모 가드
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
    SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';
    IF NOT FOUND THEN
      v_unmatched := v_unmatched || (p->>'spl_number');
      CONTINUE;
    END IF;

    -- 아이템 메타 (키가 존재하는 필드만 반영; null 값 = 삭제 의도)
    IF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
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

      -- 권위 모델 강제: 비정본 실적 쓰기는 조용히 건너뛰지 않고 즉시 실패
      IF v_auth <> 'HDEC' AND (s ? 'actual_start' OR s ? 'actual_finish') THEN
        RAISE EXCEPTION 'SPL authority violation: stage % actual is owned by % — HDEC import must not write actual dates (spl_number=%)',
          v_code, v_auth, p->>'spl_number';
      END IF;

      INSERT INTO public.spl_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
      VALUES (
        it.id, v_code,
        CASE WHEN s ? 'plan_start'    THEN nullif(s->>'plan_start','')::date    ELSE NULL END,
        CASE WHEN s ? 'actual_start'  THEN nullif(s->>'actual_start','')::date  ELSE NULL END,
        CASE WHEN s ? 'plan_finish'   THEN nullif(s->>'plan_finish','')::date   ELSE NULL END,
        CASE WHEN s ? 'actual_finish' THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
        CASE WHEN s ? 'flag_value'    THEN nullif(s->>'flag_value','')          ELSE NULL END
      )
      ON CONFLICT (item_id, stage_code) DO UPDATE SET
        plan_start    = CASE WHEN s ? 'plan_start'    THEN nullif(s->>'plan_start','')::date    ELSE spl_stage_progress.plan_start END,
        actual_start  = CASE WHEN s ? 'actual_start'  THEN nullif(s->>'actual_start','')::date  ELSE spl_stage_progress.actual_start END,
        plan_finish   = CASE WHEN s ? 'plan_finish'   THEN nullif(s->>'plan_finish','')::date   ELSE spl_stage_progress.plan_finish END,
        actual_finish = CASE WHEN s ? 'actual_finish' THEN nullif(s->>'actual_finish','')::date ELSE spl_stage_progress.actual_finish END,
        flag_value    = CASE WHEN s ? 'flag_value'    THEN nullif(s->>'flag_value','')          ELSE spl_stage_progress.flag_value END,
        updated_by = auth.uid();
      v_stages := v_stages + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('spl.change_source', 'app', true);
  PERFORM set_config('spl.batch_id', '', true);

  RETURN jsonb_build_object(
    'items_updated', v_items,
    'stages_upserted', v_stages,
    'unmatched', to_jsonb(v_unmatched)
  );
END; $$;

REVOKE ALL ON FUNCTION public.spl_hdec_apply(uuid, jsonb, boolean, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.spl_hdec_apply(uuid, jsonb, boolean, integer) TO authenticated;