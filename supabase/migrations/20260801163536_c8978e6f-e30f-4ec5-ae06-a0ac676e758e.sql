-- =========================================================
-- SPL Phase 1: 아이템 마스터 / 단계 카탈로그 / 단계 진행 / 컬럼 레벨 change_log
-- =========================================================

-- 1) 아이템 마스터
CREATE TABLE public.spl_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spl_number text NOT NULL UNIQUE,
  plot text NOT NULL CHECK (plot IN ('C','D')),
  team text CHECK (team IN ('MECH','ELEC')),
  dis text,
  service text,
  title text,
  pic text,
  eng text,
  pic_po text,
  eng_po text,
  supplier text,
  latest_status text CHECK (latest_status IN ('A','B','C','UR','NYS')),
  latest_status_raw text,
  approval_status_raw text,
  revision text,
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_items TO authenticated;
GRANT ALL ON public.spl_items TO service_role;
ALTER TABLE public.spl_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_items_select" ON public.spl_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_items_write" ON public.spl_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]));

CREATE INDEX idx_spl_items_plot ON public.spl_items(plot);
CREATE INDEX idx_spl_items_team ON public.spl_items(team);
CREATE INDEX idx_spl_items_status ON public.spl_items(latest_status);

-- 2) 단계 카탈로그
CREATE TABLE public.spl_stage_catalog (
  stage_code text PRIMARY KEY,
  module text NOT NULL DEFAULT 'SPL',
  band text NOT NULL,                       -- REQUIRED_DOC | DOCUMENTATION | PO
  sort_order int NOT NULL UNIQUE,
  label text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('flag','single','range')),
  actual_authority text NOT NULL DEFAULT 'HDEC' CHECK (actual_authority IN ('HDEC','ACONEX','CMS')),
  in_progress_denominator boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.spl_stage_catalog TO authenticated;
GRANT ALL ON public.spl_stage_catalog TO service_role;
ALTER TABLE public.spl_stage_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_catalog_select" ON public.spl_stage_catalog FOR SELECT TO authenticated USING (true);

-- 3) 단계 진행 (단계=행 정규화)
--   value_type='single' 인 단계는 plan_start/actual_start 만 사용(finish 는 NULL)
--   na_flag=true  → 해당없음 확정(진척률 분모 제외)
--   na_flag=false + 전 컬럼 NULL → 미실시(빈칸)
CREATE TABLE public.spl_stage_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.spl_items(id) ON DELETE CASCADE,
  stage_code text NOT NULL REFERENCES public.spl_stage_catalog(stage_code),
  plan_start date,
  actual_start date,
  plan_finish date,
  actual_finish date,
  flag_value text,                       -- Required Doc 밴드의 원문 상태값
  na_flag boolean NOT NULL DEFAULT false,
  remarks text,
  data_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (item_id, stage_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_stage_progress TO authenticated;
GRANT ALL ON public.spl_stage_progress TO service_role;
ALTER TABLE public.spl_stage_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_progress_select" ON public.spl_stage_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_progress_write" ON public.spl_stage_progress FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]));

CREATE INDEX idx_spl_progress_item ON public.spl_stage_progress(item_id);
CREATE INDEX idx_spl_progress_stage ON public.spl_stage_progress(stage_code);

-- 4) 컬럼 레벨 change_log (1일차 도입 / 삭제도 감사 대상)
CREATE TABLE public.spl_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  item_id uuid,
  spl_number text,
  stage_code text,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  column_name text,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'app',      -- app | hdec_import | aconex_seed | migration
  batch_id uuid,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.spl_change_log TO authenticated;
GRANT ALL ON public.spl_change_log TO service_role;
ALTER TABLE public.spl_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_change_log_select" ON public.spl_change_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_change_log_insert" ON public.spl_change_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_spl_change_log_row ON public.spl_change_log(row_id);
CREATE INDEX idx_spl_change_log_item ON public.spl_change_log(item_id);
CREATE INDEX idx_spl_change_log_batch ON public.spl_change_log(batch_id);
CREATE INDEX idx_spl_change_log_changed_at ON public.spl_change_log(changed_at DESC);

-- updated_at 트리거
CREATE OR REPLACE FUNCTION public.spl_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_spl_items_touch BEFORE UPDATE ON public.spl_items
  FOR EACH ROW EXECUTE FUNCTION public.spl_touch_updated_at();
CREATE TRIGGER trg_spl_progress_touch BEFORE UPDATE ON public.spl_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.spl_touch_updated_at();

-- 컬럼 레벨 감사 트리거 (insert/update/delete 전부)
CREATE OR REPLACE FUNCTION public.spl_audit_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j_old jsonb; j_new jsonb; k text; ov text; nv text;
  v_item uuid; v_spl text; v_stage text; v_src text;
  skip_cols text[] := ARRAY['updated_at','created_at','updated_by','created_by','id'];
BEGIN
  v_src := coalesce(current_setting('spl.change_source', true), 'app');

  IF TG_OP = 'DELETE' THEN
    j_old := to_jsonb(OLD);
    IF TG_TABLE_NAME = 'spl_items' THEN v_item := OLD.id; v_spl := OLD.spl_number;
    ELSE v_item := (j_old->>'item_id')::uuid; v_stage := j_old->>'stage_code'; END IF;
    INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, v_item, v_spl, v_stage, 'delete', NULL, j_old::text, NULL, v_src, auth.uid());
    RETURN OLD;
  END IF;

  j_new := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'spl_items' THEN v_item := NEW.id; v_spl := NEW.spl_number;
  ELSE v_item := (j_new->>'item_id')::uuid; v_stage := j_new->>'stage_code'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, v_item, v_spl, v_stage, 'insert', NULL, NULL, j_new::text, v_src, auth.uid());
    RETURN NEW;
  END IF;

  j_old := to_jsonb(OLD);
  FOR k IN SELECT jsonb_object_keys(j_new) LOOP
    IF k = ANY(skip_cols) THEN CONTINUE; END IF;
    ov := j_old->>k; nv := j_new->>k;
    IF ov IS DISTINCT FROM nv THEN
      INSERT INTO public.spl_change_log(table_name,row_id,item_id,spl_number,stage_code,action,column_name,old_value,new_value,source,changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, v_item, v_spl, v_stage, 'update', k, ov, nv, v_src, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_spl_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.spl_items
  FOR EACH ROW EXECUTE FUNCTION public.spl_audit_columns();
CREATE TRIGGER trg_spl_progress_audit AFTER INSERT OR UPDATE OR DELETE ON public.spl_stage_progress
  FOR EACH ROW EXECUTE FUNCTION public.spl_audit_columns();

-- =========================================================
-- 카탈로그 22행 시드 (SPL_Status_AconexSeeded 파일 열 순서 그대로)
-- =========================================================
INSERT INTO public.spl_stage_catalog (stage_code, band, sort_order, label, value_type, actual_authority, in_progress_denominator, note) VALUES
  ('PHYSICAL_LIST',       'REQUIRED_DOC',  1, 'Physical List',              'flag',   'HDEC',   false, '문서 요건 보유 여부'),
  ('REC_LETTER_2Y',       'REQUIRED_DOC',  2, 'Rec. Letter 2Y',             'flag',   'HDEC',   false, '문서 요건 보유 여부'),
  ('REC_LETTER_5Y',       'REQUIRED_DOC',  3, 'Rec. Letter 5Y',             'flag',   'HDEC',   false, '문서 요건 보유 여부'),
  ('AVAILABILITY_10Y',    'REQUIRED_DOC',  4, 'Availability 10Y',           'flag',   'HDEC',   false, '문서 요건 보유 여부'),
  ('OTHERS_DOC',          'REQUIRED_DOC',  5, 'Others',                     'flag',   'HDEC',   false, '문서 요건 보유 여부'),
  ('REQ_RESUBMISSION',    'DOCUMENTATION', 6, 'Request for resubmission',   'single', 'HDEC',   true,  NULL),
  ('RESPONSE_RECEIVED',   'DOCUMENTATION', 7, 'Response Received',          'single', 'HDEC',   true,  NULL),
  ('REVIEW_RESPONSE',     'DOCUMENTATION', 8, 'Review Response from Sub',   'range',  'HDEC',   true,  NULL),
  ('INTERNAL_QTY_VERIF',  'DOCUMENTATION', 9, 'Internal Q''ty Verification','range',  'HDEC',   true,  NULL),
  ('SUBSTANTIATION_PREP', 'DOCUMENTATION',10, 'Substantiation Preparation', 'range',  'HDEC',   true,  NULL),
  ('DAR_ACCEPTANCE',      'DOCUMENTATION',11, 'Dar Acceptance',             'range',  'HDEC',   true,  NULL),
  ('SUBMISSION',          'DOCUMENTATION',12, 'Submission',                 'range',  'HDEC',   true,  NULL),
  ('APPROVAL_DATE',       'DOCUMENTATION',13, 'Approval date',              'single', 'ACONEX', true,  'Actual = Aconex 정본. 선행 실적 없이 존재 가능 → 불변식 예외'),
  ('CODE_B_TO_A',         'DOCUMENTATION',14, 'Code B to A',                'range',  'HDEC',   true,  NULL),
  ('RFQ_DRAFT',           'PO',           15, 'RFQ Draft',                  'range',  'HDEC',   true,  NULL),
  ('RFQ',                 'PO',           16, 'RFQ',                        'single', 'HDEC',   true,  NULL),
  ('QUOTATION',           'PO',           17, 'Quotation',                  'single', 'HDEC',   true,  NULL),
  ('REVIEW_QUOTATION',    'PO',           18, 'Review Quotation',           'range',  'HDEC',   true,  NULL),
  ('CONFIRM_QUOTATION',   'PO',           19, 'Confirmation of Quotation',  'single', 'HDEC',   true,  NULL),
  ('HQ_APPROVAL',         'PO',           20, 'HQ (above 100K)',            'range',  'HDEC',   true,  NULL),
  ('MRS',                 'PO',           21, 'MRS',                        'range',  'HDEC',   true,  NULL),
  ('PO_ISSUANCE',         'PO',           22, 'Issuance of PO',             'single', 'HDEC',   true,  NULL);

-- =========================================================
-- 불변식 = 검출형 뷰 (하드 트리거 없음)
-- 적용 범위: actual_authority='HDEC' 이고 value_type<>'flag' 인 단계들 사이에서만.
--   · APPROVAL_DATE(Aconex 정본)는 선행 실적 없이 존재 가능 → 위반 판정에서 제외하며
--     선행 단계 존재 여부 계산에서도 제외한다(정본 구조상 정상).
--   · Required Doc(flag) 밴드는 날짜 단계가 아니므로 제외.
-- =========================================================
CREATE OR REPLACE VIEW public.spl_precedence_violations AS
WITH hdec AS (
  SELECT p.item_id, p.stage_code, c.sort_order, c.label,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any
  FROM public.spl_stage_progress p
  JOIN public.spl_stage_catalog c ON c.stage_code = p.stage_code
  WHERE c.actual_authority = 'HDEC' AND c.value_type <> 'flag'
)
SELECT h.item_id,
       i.spl_number,
       i.plot,
       i.team,
       h.stage_code,
       h.label,
       h.sort_order,
       h.actual_any AS actual_date,
       (SELECT count(*) FROM hdec pr
         WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL) AS missing_predecessors
FROM hdec h
JOIN public.spl_items i ON i.id = h.item_id
WHERE h.actual_any IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM hdec pr
    WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL
  );

GRANT SELECT ON public.spl_precedence_violations TO authenticated;
GRANT ALL ON public.spl_precedence_violations TO service_role;