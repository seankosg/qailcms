-- =============================================================
-- TOC (Handover) 모듈 — Phase 0/1: 등록 + 스키마 + 카탈로그 + 가드 + 검출 뷰
-- 기존 spl_* 자산은 수정하지 않는다. spl_stage_state()는 호출만 한다.
-- =============================================================

-- ---------- 1. 아이템 마스터 ----------
CREATE TABLE public.toc_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_key text NOT NULL UNIQUE,
  plot text NOT NULL DEFAULT 'D' CHECK (plot IN ('C','D')),
  -- team = 권한 판정용 정규화 팀 코드(Civil→ARCH). 원문은 team_raw 보관.
  team text CHECK (team IS NULL OR team IN ('MECH','ELEC','ARCH','PRJC')),
  team_raw text,
  main_system text,
  item_no text,
  sub_system text,
  location text,
  supplier text,
  pic text,
  eng text,
  owner_user_id uuid,
  tac_qty_total integer,
  tac_qty_issued integer,
  abd_qty_total integer,
  abd_qty_code_a integer,
  service_report_required boolean NOT NULL DEFAULT true,
  toc_ref text,
  toc_status text NOT NULL DEFAULT 'Not Submitted'
    CHECK (toc_status IN ('Not Submitted','UR IFM','Code A','Code C')),
  expected_ho_date date,
  ho_status_raw text,
  -- 타 모듈 참조는 이번 범위 밖. 링크용 컬럼만 예약한다.
  abd_filter jsonb,
  tm_task_nos text[],
  is_active boolean NOT NULL DEFAULT true,
  is_excluded boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  data_date date,
  source_file text,
  source_sheet text,
  source_row integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX toc_items_main_system_idx ON public.toc_items(main_system);
CREATE INDEX toc_items_team_idx ON public.toc_items(team);
CREATE INDEX toc_items_toc_ref_idx ON public.toc_items(toc_ref);

-- ---------- 2. 단계 카탈로그 ----------
CREATE TABLE public.toc_stage_catalog (
  stage_code text NOT NULL PRIMARY KEY,
  module text NOT NULL DEFAULT 'TOC',
  band text NOT NULL CHECK (band IN ('TAC','OMM','TRAINING','ASSET_TAG','ABD','SERVICE_REPORT','TOC')),
  sort_order integer NOT NULL UNIQUE,
  label text NOT NULL,
  short_code text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('code','single','range')),
  actual_authority text NOT NULL DEFAULT 'HDEC' CHECK (actual_authority IN ('HDEC','IFM','CMS')),
  -- 완료 코드 사전. code 단계는 반드시 비어 있지 않아야 한다(코드 하드코딩 금지의 근거).
  done_codes text[] NOT NULL DEFAULT '{}'::text[],
  gate_band text,
  in_progress_denominator boolean NOT NULL DEFAULT true,
  chain_excluded boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT toc_stage_catalog_done_codes_check
    CHECK (value_type <> 'code' OR array_length(done_codes, 1) >= 1)
);

-- ---------- 3. 단계 진행 ----------
CREATE TABLE public.toc_stage_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.toc_items(id) ON DELETE CASCADE,
  stage_code text NOT NULL REFERENCES public.toc_stage_catalog(stage_code),
  plan_start date,
  plan_finish date,
  actual_start date,
  actual_finish date,
  code_value text,
  na_flag boolean NOT NULL DEFAULT false,
  remarks text,
  data_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (item_id, stage_code)
);
CREATE INDEX toc_stage_progress_stage_idx ON public.toc_stage_progress(stage_code);

-- ---------- 4. 교육 세션 (정본) ----------
CREATE TABLE public.toc_training_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_key text NOT NULL UNIQUE,
  subject text,
  team text,
  team_raw text,
  supplier text,
  mnl_doc_no text,
  plan_date date,
  conducted_date date,
  site_demo_date date,
  ifm_feedback_date date,
  hdec_response_date date,
  ifm_review_date date,
  hdec_response2_date date,
  eval_form_date date,
  ifm_status text,
  eval_form_status text,
  no_comments boolean NOT NULL DEFAULT false,
  remarks text,
  is_active boolean NOT NULL DEFAULT true,
  data_date date,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE TABLE public.toc_item_training_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.toc_items(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.toc_training_sessions(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (item_id, session_id)
);
CREATE INDEX toc_item_training_links_session_idx ON public.toc_item_training_links(session_id);

CREATE TABLE public.toc_training_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.toc_training_sessions(id) ON DELETE CASCADE,
  round smallint NOT NULL CHECK (round BETWEEN 1 AND 4),
  author_side text NOT NULL CHECK (author_side IN ('IFM','HDEC')),
  comment_text text,
  comment_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
CREATE INDEX toc_training_comments_session_idx ON public.toc_training_comments(session_id);

-- ---------- 5. 변경 이력 ----------
CREATE TABLE public.toc_change_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  item_id uuid,
  item_key text,
  session_id uuid,
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
CREATE INDEX toc_change_log_item_idx ON public.toc_change_log(item_id);
CREATE INDEX toc_change_log_batch_idx ON public.toc_change_log(batch_id);

-- ---------- 6. 임포트 로그 ----------
CREATE TABLE public.toc_import_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name text NOT NULL,
  sheet_names text[] NOT NULL DEFAULT '{}'::text[],
  total_rows integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  unmatched integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  stages_upserted integer NOT NULL DEFAULT 0,
  sessions_upserted integer NOT NULL DEFAULT 0,
  cleared_values integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  note text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  rollback_force boolean NOT NULL DEFAULT false
);

CREATE TABLE public.toc_import_row_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.toc_import_logs(id) ON DELETE CASCADE,
  sheet_name text,
  excel_row integer,
  item_key text,
  session_key text,
  outcome text NOT NULL,
  code text,
  detail text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX toc_import_row_logs_batch_idx ON public.toc_import_row_logs(batch_id);

-- ---------- 7. 설정 ----------
CREATE TABLE public.toc_settings (
  key text NOT NULL PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- 8. GRANT ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_stage_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_stage_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_training_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_item_training_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_training_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_change_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_import_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_import_row_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.toc_settings TO authenticated;
GRANT ALL ON public.toc_items TO service_role;
GRANT ALL ON public.toc_stage_catalog TO service_role;
GRANT ALL ON public.toc_stage_progress TO service_role;
GRANT ALL ON public.toc_training_sessions TO service_role;
GRANT ALL ON public.toc_item_training_links TO service_role;
GRANT ALL ON public.toc_training_comments TO service_role;
GRANT ALL ON public.toc_change_log TO service_role;
GRANT ALL ON public.toc_import_logs TO service_role;
GRANT ALL ON public.toc_import_row_logs TO service_role;
GRANT ALL ON public.toc_settings TO service_role;

-- ---------- 9. RLS ----------
ALTER TABLE public.toc_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_stage_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_stage_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_item_training_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_training_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_import_row_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toc_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY toc_items_select ON public.toc_items FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_items_insert ON public.toc_items FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can_values('TOC', jsonb_build_object('team', team, 'pic', pic, 'eng', eng), 'write'));
CREATE POLICY toc_items_update ON public.toc_items FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', id, 'write'))
  WITH CHECK (public.rcl_can_values('TOC', jsonb_build_object('team', team, 'pic', pic, 'eng', eng), 'write'));
CREATE POLICY toc_items_delete ON public.toc_items FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', id, 'delete'));

-- 카탈로그는 조회만. 변경은 마이그레이션으로만 한다(SPL 선례 동일).
CREATE POLICY toc_catalog_select ON public.toc_stage_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY toc_progress_select ON public.toc_stage_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_progress_insert ON public.toc_stage_progress FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'));
CREATE POLICY toc_progress_update ON public.toc_stage_progress FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'))
  WITH CHECK (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'));
CREATE POLICY toc_progress_delete ON public.toc_stage_progress FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', item_id, 'delete'));

CREATE POLICY toc_sessions_select ON public.toc_training_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_sessions_insert ON public.toc_training_sessions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_sessions_update ON public.toc_training_sessions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_sessions_delete ON public.toc_training_sessions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','delete') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

CREATE POLICY toc_links_select ON public.toc_item_training_links FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_links_insert ON public.toc_item_training_links FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'));
CREATE POLICY toc_links_update ON public.toc_item_training_links FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'))
  WITH CHECK (public.rcl_can(auth.uid(), 'TOC', item_id, 'write'));
CREATE POLICY toc_links_delete ON public.toc_item_training_links FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TOC', item_id, 'delete'));

CREATE POLICY toc_tcomments_select ON public.toc_training_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_tcomments_insert ON public.toc_training_comments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_tcomments_update ON public.toc_training_comments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_tcomments_delete ON public.toc_training_comments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','delete') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

CREATE POLICY toc_change_log_select ON public.toc_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_change_log_insert ON public.toc_change_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

CREATE POLICY toc_import_logs_select ON public.toc_import_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_import_logs_insert ON public.toc_import_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_import_logs_update ON public.toc_import_logs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_import_logs_delete ON public.toc_import_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

CREATE POLICY toc_import_row_logs_select ON public.toc_import_row_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_import_row_logs_insert ON public.toc_import_row_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_import_row_logs_delete ON public.toc_import_row_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','import') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

CREATE POLICY toc_settings_select ON public.toc_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY toc_settings_insert ON public.toc_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));
CREATE POLICY toc_settings_update ON public.toc_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rcl_grants('TOC','write') g
    WHERE coalesce((g->>'own')::boolean,false) OR coalesce((g->>'own_team')::boolean,false)
       OR coalesce((g->>'other_team')::boolean,false)));

-- ---------- 10. 공통 트리거 함수 ----------
CREATE OR REPLACE FUNCTION public.toc_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.toc_audit_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j_old jsonb; j_new jsonb; k text; ov text; nv text;
  v_item uuid; v_key text; v_session uuid; v_stage text; v_src text; v_batch uuid;
  skip_cols text[] := ARRAY['updated_at','created_at','updated_by','created_by','id'];
BEGIN
  v_src := coalesce(current_setting('toc.change_source', true), 'app');
  BEGIN
    v_batch := nullif(current_setting('toc.batch_id', true), '')::uuid;
  EXCEPTION WHEN others THEN v_batch := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    j_old := to_jsonb(OLD);
  ELSE
    j_new := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'toc_items' THEN
    v_item := coalesce((j_new->>'id')::uuid, (j_old->>'id')::uuid);
    v_key  := coalesce(j_new->>'item_key', j_old->>'item_key');
  ELSIF TG_TABLE_NAME = 'toc_training_sessions' THEN
    v_session := coalesce((j_new->>'id')::uuid, (j_old->>'id')::uuid);
  ELSE
    v_item    := coalesce((j_new->>'item_id')::uuid, (j_old->>'item_id')::uuid);
    v_session := coalesce((j_new->>'session_id')::uuid, (j_old->>'session_id')::uuid);
    v_stage   := coalesce(j_new->>'stage_code', j_old->>'stage_code');
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.toc_change_log(table_name,row_id,item_id,item_key,session_id,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, v_item, v_key, v_session, v_stage, 'delete', NULL, j_old::text, NULL, v_src, v_batch, auth.uid());
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.toc_change_log(table_name,row_id,item_id,item_key,session_id,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_item, v_key, v_session, v_stage, 'insert', NULL, NULL, j_new::text, v_src, v_batch, auth.uid());
    RETURN NEW;
  END IF;

  j_old := to_jsonb(OLD);
  FOR k IN SELECT jsonb_object_keys(j_new) LOOP
    IF k = ANY(skip_cols) THEN CONTINUE; END IF;
    ov := j_old->>k; nv := j_new->>k;
    IF ov IS DISTINCT FROM nv THEN
      INSERT INTO public.toc_change_log(table_name,row_id,item_id,item_key,session_id,stage_code,action,column_name,old_value,new_value,source,batch_id,changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, v_item, v_key, v_session, v_stage, 'update', k, ov, nv, v_src, v_batch, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.toc_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND coalesce(NEW.pic,'') = coalesce(OLD.pic,'')
     AND coalesce(NEW.eng,'') = coalesce(OLD.eng,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := coalesce(
    public.resolve_user_by_name(nullif(btrim(coalesce(NEW.pic,'')), '')),
    public.resolve_user_by_name(nullif(btrim(coalesce(NEW.eng,'')), ''))
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_toc_items_touch BEFORE UPDATE ON public.toc_items
  FOR EACH ROW EXECUTE FUNCTION public.toc_touch_updated_at();
CREATE TRIGGER trg_toc_items_owner BEFORE INSERT OR UPDATE ON public.toc_items
  FOR EACH ROW EXECUTE FUNCTION public.toc_auto_owner_user_id();
CREATE TRIGGER trg_toc_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.toc_items
  FOR EACH ROW EXECUTE FUNCTION public.toc_audit_columns();

CREATE TRIGGER trg_toc_progress_touch BEFORE UPDATE ON public.toc_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.toc_touch_updated_at();
CREATE TRIGGER trg_toc_progress_audit AFTER INSERT OR UPDATE OR DELETE ON public.toc_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.toc_audit_columns();

CREATE TRIGGER trg_toc_sessions_touch BEFORE UPDATE ON public.toc_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.toc_touch_updated_at();
CREATE TRIGGER trg_toc_sessions_audit AFTER INSERT OR UPDATE OR DELETE ON public.toc_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.toc_audit_columns();

CREATE TRIGGER trg_toc_links_audit AFTER INSERT OR UPDATE OR DELETE ON public.toc_item_training_links
  FOR EACH ROW EXECUTE FUNCTION public.toc_audit_columns();

CREATE TRIGGER trg_toc_tcomments_touch BEFORE UPDATE ON public.toc_training_comments
  FOR EACH ROW EXECUTE FUNCTION public.toc_touch_updated_at();

CREATE TRIGGER trg_toc_import_logs_touch BEFORE UPDATE ON public.toc_import_logs
  FOR EACH ROW EXECUTE FUNCTION public.toc_touch_updated_at();

-- ---------- 11. 코드 → 완료 정규화 (한 곳에서만) ----------
-- spl_stage_state 는 flag/single/range 만 안다. code 단계는 완료 코드 사전과
-- 일치할 때만 flag 로 정규화해서 넘긴다(미승인 코드가 done 으로 잡히는 것을 막는다).
CREATE OR REPLACE FUNCTION public.toc_code_flag(_value_type text, _code_value text, _done_codes text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _value_type <> 'code' THEN NULL
    WHEN nullif(btrim(coalesce(_code_value,'')),'') IS NULL THEN NULL
    WHEN upper(btrim(_code_value)) IN (
      SELECT upper(btrim(x)) FROM unnest(coalesce(_done_codes,'{}'::text[])) x
    ) THEN 'DONE'
    ELSE NULL
  END
$$;

-- ---------- 12. 밴드 상태 (병렬 밴드 정본) ----------
CREATE OR REPLACE FUNCTION public.toc_band_state(_item_id uuid, _band text, _as_of date DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  d date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_all int; v_na int; v_denom int; v_done int; v_act int; v_plan int; v_tac text;
BEGIN
  WITH st AS (
    SELECT public.spl_stage_state(
             CASE WHEN c.value_type = 'code' THEN 'flag' ELSE c.value_type END,
             p.plan_start, p.plan_finish,
             CASE WHEN p.actual_start  <= d THEN p.actual_start  END,
             CASE WHEN p.actual_finish <= d THEN p.actual_finish END,
             public.toc_code_flag(c.value_type, p.code_value, c.done_codes),
             p.na_flag, d) AS state
    FROM public.toc_stage_catalog c
    LEFT JOIN public.toc_stage_progress p
      ON p.item_id = _item_id AND p.stage_code = c.stage_code
    WHERE c.band = _band
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE state = 'na')::int,
         count(*) FILTER (WHERE state NOT IN ('na','none'))::int,
         count(*) FILTER (WHERE state = 'done')::int,
         count(*) FILTER (WHERE state IN ('wip','delayed'))::int,
         count(*) FILTER (WHERE state = 'planned')::int
    INTO v_all, v_na, v_denom, v_done, v_act, v_plan
    FROM st;

  IF coalesce(v_all,0) = 0 THEN RETURN 'empty'; END IF;
  IF v_na = v_all THEN RETURN 'na'; END IF;
  IF v_denom > 0 AND v_done = v_denom THEN RETURN 'complete'; END IF;

  -- TRAINING 은 TAC 밴드가 닫힌 뒤에만 시작할 수 있다.
  -- 이미 실적이 들어 있으면 blocked 로 감추지 않고 검출 뷰가 보고한다.
  IF _band = 'TRAINING' AND v_done = 0 AND v_act = 0 THEN
    v_tac := public.toc_band_state(_item_id, 'TAC', d);
    IF v_tac IS DISTINCT FROM 'complete' THEN RETURN 'blocked'; END IF;
  END IF;

  IF v_act > 0 THEN RETURN 'active'; END IF;
  IF v_plan > 0 THEN RETURN 'planned'; END IF;
  RETURN 'empty';
END $$;

-- ---------- 13. 쓰기 가드 (TAC → TRAINING) ----------
CREATE OR REPLACE FUNCTION public.toc_assert_row_rules(_item_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_key text; v_has_actual boolean;
BEGIN
  -- 1회 시딩은 이 가드를 통과하지 못한다(원천에 TAC 미완·교육 완료 건이 실재).
  IF coalesce(current_setting('toc.seed', true), '') = 'on' THEN RETURN; END IF;

  SELECT item_key INTO v_key FROM public.toc_items WHERE id = _item_id;
  IF v_key IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.toc_stage_catalog c
    JOIN public.toc_stage_progress p ON p.item_id = _item_id AND p.stage_code = c.stage_code
    WHERE c.band = 'TRAINING'
      AND NOT coalesce(p.na_flag, false)
      AND (p.actual_start IS NOT NULL OR p.actual_finish IS NOT NULL
           OR nullif(btrim(coalesce(p.code_value,'')),'') IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM public.toc_item_training_links l
    JOIN public.toc_training_sessions s ON s.id = l.session_id
    WHERE l.item_id = _item_id AND s.conducted_date IS NOT NULL
  ) INTO v_has_actual;

  IF v_has_actual AND public.toc_band_state(_item_id, 'TAC') IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION
      E'%s: Training actuals cannot be recorded.\nTesting & Commissioning (T&C) is not complete for this sub system.',
      v_key USING ERRCODE = '23514';
  END IF;
END $$;

-- ---------- 14. 검출 뷰 (경보만. 하드 트리거 없음) ----------
CREATE OR REPLACE VIEW public.toc_precedence_violations AS
WITH bs AS (
  SELECT i.id AS item_id, i.item_key, i.main_system, i.sub_system, i.team, i.toc_ref, i.toc_status,
         public.toc_band_state(i.id,'TAC')            AS tac,
         public.toc_band_state(i.id,'OMM')            AS omm,
         public.toc_band_state(i.id,'TRAINING')       AS training,
         public.toc_band_state(i.id,'ASSET_TAG')      AS asset_tag,
         public.toc_band_state(i.id,'ABD')            AS abd,
         public.toc_band_state(i.id,'SERVICE_REPORT') AS service_report
  FROM public.toc_items i
  WHERE i.is_active
)
SELECT 'training_before_tac'::text AS violation_type, b.item_id, b.item_key, b.main_system, b.sub_system,
       b.team, NULL::text AS session_key,
       'T&C is not complete but training actuals exist'::text AS detail
FROM bs b
WHERE b.tac IS DISTINCT FROM 'complete' AND b.training IN ('complete','active','planned')
UNION ALL
SELECT 'toc_submit_before_ready', b.item_id, b.item_key, b.main_system, b.sub_system, b.team, NULL,
       'TOC submitted while prerequisite bands are not complete'
FROM bs b
JOIN public.toc_stage_progress p ON p.item_id = b.item_id AND p.stage_code = 'TOC_SUBMIT'
WHERE coalesce(p.actual_finish, p.actual_start) IS NOT NULL
  AND NOT (b.tac IN ('complete','na') AND b.omm IN ('complete','na') AND b.training IN ('complete','na')
       AND b.asset_tag IN ('complete','na') AND b.abd IN ('complete','na')
       AND b.service_report IN ('complete','na'))
UNION ALL
SELECT 'no_training_link', b.item_id, b.item_key, b.main_system, b.sub_system, b.team, NULL,
       'No training session is linked to this sub system'
FROM bs b
WHERE b.training <> 'na'
  AND NOT EXISTS (SELECT 1 FROM public.toc_item_training_links l WHERE l.item_id = b.item_id)
UNION ALL
SELECT 'training_sequence', l.item_id, i.item_key, i.main_system, i.sub_system, i.team, s.session_key,
       'A later training date exists without its preceding date'
FROM public.toc_training_sessions s
JOIN public.toc_item_training_links l ON l.session_id = s.id
JOIN public.toc_items i ON i.id = l.item_id
WHERE s.is_active
  AND ((s.eval_form_date    IS NOT NULL AND s.conducted_date     IS NULL)
    OR (s.ifm_review_date   IS NOT NULL AND s.hdec_response_date IS NULL)
    OR (s.hdec_response_date IS NOT NULL AND s.ifm_feedback_date IS NULL)
    OR (s.ifm_feedback_date IS NOT NULL AND s.conducted_date     IS NULL))
UNION ALL
SELECT 'toc_ref_inconsistent', i.id, i.item_key, i.main_system, i.sub_system, i.team, NULL,
       'Items sharing this TOC reference report different TOC statuses'
FROM public.toc_items i
WHERE i.is_active AND nullif(btrim(coalesce(i.toc_ref,'')),'') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.toc_items o
    WHERE o.is_active AND o.id <> i.id
      AND upper(btrim(o.toc_ref)) = upper(btrim(i.toc_ref))
      AND o.toc_status IS DISTINCT FROM i.toc_status
  );

GRANT SELECT ON public.toc_precedence_violations TO authenticated;
GRANT SELECT ON public.toc_precedence_violations TO service_role;

-- ---------- 15. 카탈로그 시드 (밴드 7개 · code 단계는 완료 코드 사전 필수) ----------
INSERT INTO public.toc_stage_catalog
  (stage_code, band, sort_order, label, short_code, value_type, actual_authority, done_codes, gate_band, note)
VALUES
  ('TAC_COMPLETION','TAC',1,'T&C Completion','T-CP','code','HDEC',ARRAY['Completed'],NULL,'Testing & Commissioning closure'),
  ('OMM_APPROVAL','OMM',2,'O&M Manual Approval','O-AP','code','HDEC',ARRAY['Approved'],NULL,'Aconex approval code transcribed'),
  ('TRN_CONDUCTED','TRAINING',3,'Training Conducted','R-CD','single','CMS','{}'::text[],'TAC','Rolled up from linked sessions (earliest conducted date)'),
  ('TRN_EVAL_FORM','TRAINING',4,'Evaluation Form Received','R-EF','single','CMS','{}'::text[],'TAC','Rolled up from linked sessions (all forms received)'),
  ('AT_LIST','ASSET_TAG',5,'Asset Tag List','A-LS','single','HDEC','{}'::text[],NULL,NULL),
  ('AT_INSTALL','ASSET_TAG',6,'Asset Tag Installation','A-IN','single','HDEC','{}'::text[],NULL,NULL),
  ('AT_APPROVAL','ASSET_TAG',7,'Asset Tag Approval','A-AP','code','HDEC',ARRAY['Code A','Approved'],NULL,NULL),
  ('ABD_CODE_A','ABD',8,'As-Built Code A','B-CA','code','HDEC',ARRAY['Completed'],NULL,'Quantity based completion, code decides closure'),
  ('SR_ISSUED','SERVICE_REPORT',9,'Service Report Issued','S-IS','single','HDEC','{}'::text[],NULL,'N/A items are marked na_flag'),
  ('TOC_SUBMIT','TOC',10,'TOC Submission','C-SB','single','HDEC','{}'::text[],NULL,'CER document submitted to IFM'),
  ('TOC_RESPONSE','TOC',11,'IFM Response','C-RS','code','IFM',ARRAY['Code A'],NULL,'Code C means resubmission in the same stage'),
  ('HANDED_OVER','TOC',12,'Handed Over','C-HO','single','IFM','{}'::text[],NULL,NULL);

-- ---------- 16. 모듈 등록 ----------
INSERT INTO public.rcl_module_config (module, table_name, owning_team, owner_cols, team_col)
VALUES ('TOC','toc_items','PRJC',ARRAY['pic','eng'],'team')
ON CONFLICT (module) DO UPDATE
  SET table_name = EXCLUDED.table_name,
      owning_team = EXCLUDED.owning_team,
      owner_cols = EXCLUDED.owner_cols,
      team_col = EXCLUDED.team_col,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.get_backup_tables()
RETURNS text[] LANGUAGE sql STABLE SET search_path TO 'public' AS $$
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
    'spl_documents','spl_document_item_links','spl_document_pages','spl_ocs_comment_document_links',
    'toc_items','toc_stage_catalog','toc_stage_progress','toc_training_sessions','toc_item_training_links',
    'toc_training_comments','toc_change_log','toc_settings','toc_import_logs','toc_import_row_logs'
  ]::text[];
$$;