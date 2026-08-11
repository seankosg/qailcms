-- =========================
-- SPL Field Config
-- =========================
CREATE TABLE IF NOT EXISTS public.spl_field_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key text NOT NULL UNIQUE,
  label text NOT NULL,
  "group" text,
  data_type text NOT NULL DEFAULT 'text',
  editable boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  options jsonb,
  source_group text NOT NULL DEFAULT 'hdec',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_field_config_source_group_chk CHECK (source_group IN ('hdec','aconex','system'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_field_config TO authenticated;
GRANT ALL ON public.spl_field_config TO service_role;
ALTER TABLE public.spl_field_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_field_config_select" ON public.spl_field_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_field_config_admin_write" ON public.spl_field_config TO authenticated
  USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE TRIGGER trg_spl_field_config_updated_at BEFORE UPDATE ON public.spl_field_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- SPL Header Mappings
-- =========================
CREATE TABLE IF NOT EXISTS public.spl_header_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form text NOT NULL,
  source_header text NOT NULL,
  target_field text NOT NULL,
  stage text,
  plan_or_actual text,
  is_custom boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_header_mappings_form_chk CHECK (form IN ('HDEC','VIEW','ACONEX'))
);

CREATE UNIQUE INDEX IF NOT EXISTS spl_header_mappings_uniq
  ON public.spl_header_mappings (form, lower(source_header), coalesce(stage,''), coalesce(plan_or_actual,''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_header_mappings TO authenticated;
GRANT ALL ON public.spl_header_mappings TO service_role;
ALTER TABLE public.spl_header_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_header_mappings_select" ON public.spl_header_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_header_mappings_admin_write" ON public.spl_header_mappings TO authenticated
  USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE TRIGGER trg_spl_header_mappings_updated_at BEFORE UPDATE ON public.spl_header_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- SPL Import Presets
-- =========================
CREATE TABLE IF NOT EXISTS public.spl_import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  label text NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spl_import_presets_mode_chk CHECK (mode IN ('hdec','aconex'))
);
CREATE INDEX IF NOT EXISTS spl_import_presets_mode_sort_idx ON public.spl_import_presets (mode, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spl_import_presets TO authenticated;
GRANT ALL ON public.spl_import_presets TO service_role;
ALTER TABLE public.spl_import_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spl_import_presets_select" ON public.spl_import_presets FOR SELECT TO authenticated USING (true);
CREATE POLICY "spl_import_presets_admin_write" ON public.spl_import_presets TO authenticated
  USING (public.is_admin_or_super(auth.uid())) WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE TRIGGER trg_spl_import_presets_updated_at BEFORE UPDATE ON public.spl_import_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- Seed: base / derived fields (SPL_COLUMNS 반영)
-- =========================
INSERT INTO public.spl_field_config (field_key, label, "group", data_type, editable, visible, sort_order, source_group) VALUES
  ('spl_number','SPL NUMBER','Basic','text',false,true,10,'aconex'),
  ('plot','Plot','Basic','text',true,true,20,'hdec'),
  ('team','Team','Basic','text',true,true,30,'hdec'),
  ('judgment','Status','Derived','text',false,true,40,'system'),
  ('progress_pct','Progress','Derived','number',false,true,50,'system'),
  ('completed_stage','Completed Stage','Derived','text',false,true,60,'system'),
  ('current_stage','Current Stage','Derived','text',false,true,70,'system'),
  ('primary_delay','Primary Delay','Derived','text',false,true,80,'system'),
  ('pic','HDEC PIC','Basic','text',true,true,90,'hdec'),
  ('eng','HDEC ENG','Basic','text',true,true,100,'hdec'),
  ('pic_po','PO HDEC PIC','Basic','text',true,true,110,'hdec'),
  ('eng_po','PO HDEC ENG','Basic','text',true,true,120,'hdec'),
  ('req_doc','Req.Doc','Derived','text',false,true,130,'system'),
  ('ocs','OCS','Derived','text',false,true,140,'system'),
  ('rsp','RSP','Derived','text',false,true,150,'system'),
  ('documents','Documents','Derived','text',false,true,160,'system'),
  ('data_date','Data Date','Basic','date',true,true,170,'hdec'),
  ('supplier','Supplier','Basic','text',true,true,180,'hdec'),
  ('latest_status','Latest Status','Basic','text',false,true,190,'aconex'),
  ('dis','DIS','Basic','text',false,true,200,'aconex'),
  ('service','Service','Basic','text',false,true,210,'aconex'),
  ('title','Title','Basic','text',false,true,220,'aconex'),
  ('revision','Revision','Basic','text',false,false,230,'aconex'),
  ('approval_status_raw','Approval Status (원본)','Basic','text',false,false,240,'aconex')
ON CONFLICT (field_key) DO NOTHING;

-- Seed: stage fields from catalog
INSERT INTO public.spl_field_config (field_key, label, "group", data_type, editable, visible, sort_order, source_group)
SELECT
  'stage:' || c.stage_code || '|' || f.field,
  c.short_code || f.sfx || ' · ' || c.label || CASE WHEN f.name <> '' THEN ' — ' || f.name ELSE '' END,
  c.band,
  CASE WHEN f.field = 'fv' THEN 'text' ELSE 'date' END,
  true,
  true,
  1000 + c.sort_order * 10 + f.ord,
  CASE WHEN c.actual_authority = 'ACONEX' AND f.field IN ('as','af') THEN 'aconex' ELSE 'hdec' END
FROM public.spl_stage_catalog c
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('fv','','',0,'flag'),
    ('ps','-PD','Plan Date',1,'single'),
    ('as','-AD','Actual Date',2,'single'),
    ('ps','-PS','Plan Start',1,'range'),
    ('as','-AS','Actual Start',2,'range'),
    ('pf','-PF','Plan Finish',3,'range'),
    ('af','-AF','Actual Finish',4,'range')
  ) AS t(field, sfx, name, ord, vt)
  WHERE t.vt = c.value_type
) f
ON CONFLICT (field_key) DO NOTHING;

-- =========================
-- Seed: HDEC form header mappings (4행 헤더 왕복 양식)
-- =========================
INSERT INTO public.spl_header_mappings (form, source_header, target_field, stage, plan_or_actual, is_custom, is_active, note) VALUES
  ('HDEC','SPL NUMBER','spl_number',NULL,NULL,false,true,'행 매칭 유니크 키'),
  ('HDEC','TEAM','team',NULL,NULL,false,true,'CIVIL→PRJC, MEP→ELEC 정규화'),
  ('HDEC','HDEC PIC','pic',NULL,NULL,false,true,NULL),
  ('HDEC','HDEC ENG','eng',NULL,NULL,false,true,NULL),
  ('HDEC','HDEC PIC (PO)','pic_po',NULL,NULL,false,true,NULL),
  ('HDEC','HDEC ENG (PO)','eng_po',NULL,NULL,false,true,NULL),
  ('HDEC','SUPPLIER','supplier',NULL,NULL,false,true,NULL),
  ('HDEC','DIS','dis',NULL,NULL,false,false,'Aconex 정본 — HDEC 임포트에서 무시'),
  ('HDEC','SERVICE','service',NULL,NULL,false,false,'Aconex 정본 — HDEC 임포트에서 무시'),
  ('HDEC','DOCUMENT TITLE','title',NULL,NULL,false,false,'Aconex 정본 — HDEC 임포트에서 무시'),
  ('HDEC','APPROVAL STATUS','latest_status',NULL,NULL,false,false,'Aconex 정본 — HDEC 임포트에서 무시')
ON CONFLICT DO NOTHING;

INSERT INTO public.spl_header_mappings (form, source_header, target_field, stage, plan_or_actual, is_custom, is_active, note)
SELECT
  'HDEC',
  c.label,
  'stage:' || c.stage_code || '|' || f.field,
  f.stg,
  f.pa,
  false,
  true,
  CASE WHEN c.actual_authority = 'ACONEX' AND f.field IN ('as','af')
       THEN 'Aconex 권위 단계 — 실적은 값이 있을 때만 반영' ELSE NULL END
FROM public.spl_stage_catalog c
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('fv','flag',NULL::text,'flag'),
    ('ps',NULL,'plan','single'),
    ('as',NULL,'actual','single'),
    ('ps','start','plan','range'),
    ('as','start','actual','range'),
    ('pf','finish','plan','range'),
    ('af','finish','actual','range')
  ) AS t(field, stg, pa, vt)
  WHERE t.vt = c.value_type
) f
ON CONFLICT DO NOTHING;

-- =========================
-- Seed: VIEW form (Raw Data 화면 표시 그대로 내보낸 양식)
-- =========================
INSERT INTO public.spl_header_mappings (form, source_header, target_field, stage, plan_or_actual, is_custom, is_active, note) VALUES
  ('VIEW','SPL NUMBER','spl_number',NULL,NULL,false,true,'행 매칭 유니크 키'),
  ('VIEW','Plot','plot',NULL,NULL,false,true,'필수 컬럼 — 없으면 임포트 거부'),
  ('VIEW','Team','team',NULL,NULL,false,true,'CIVIL→PRJC, MEP→ELEC 정규화'),
  ('VIEW','HDEC PIC','pic',NULL,NULL,false,true,NULL),
  ('VIEW','HDEC ENG','eng',NULL,NULL,false,true,NULL),
  ('VIEW','PO HDEC PIC','pic_po',NULL,NULL,false,true,NULL),
  ('VIEW','PO HDEC ENG','eng_po',NULL,NULL,false,true,NULL),
  ('VIEW','PIC','pic',NULL,NULL,false,true,'구 라벨 별칭'),
  ('VIEW','ENG','eng',NULL,NULL,false,true,'구 라벨 별칭'),
  ('VIEW','PIC PO','pic_po',NULL,NULL,false,true,'구 라벨 별칭'),
  ('VIEW','ENG PO','eng_po',NULL,NULL,false,true,'구 라벨 별칭'),
  ('VIEW','Supplier','supplier',NULL,NULL,false,true,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.spl_header_mappings (form, source_header, target_field, stage, plan_or_actual, is_custom, is_active, note)
SELECT
  'VIEW',
  c.short_code || f.sfx,
  'stage:' || c.stage_code || '|' || f.field,
  f.stg,
  f.pa,
  false,
  true,
  CASE WHEN c.actual_authority = 'ACONEX' AND f.field IN ('as','af')
       THEN 'Aconex 권위 단계 — 실적은 값이 있을 때만 반영' ELSE NULL END
FROM public.spl_stage_catalog c
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('fv','','flag',NULL::text,'flag'),
    ('ps','-PD',NULL,'plan','single'),
    ('as','-AD',NULL,'actual','single'),
    ('ps','-PS','start','plan','range'),
    ('as','-AS','start','actual','range'),
    ('pf','-PF','finish','plan','range'),
    ('af','-AF','finish','actual','range')
  ) AS t(field, sfx, stg, pa, vt)
  WHERE t.vt = c.value_type
) f
ON CONFLICT DO NOTHING;

-- =========================
-- Seed: ACONEX form (Aconex 시딩본 정본 컬럼)
-- =========================
INSERT INTO public.spl_header_mappings (form, source_header, target_field, stage, plan_or_actual, is_custom, is_active, note) VALUES
  ('ACONEX','Document No','spl_number',NULL,NULL,false,true,'유니크 키'),
  ('ACONEX','DIS','dis',NULL,NULL,false,true,NULL),
  ('ACONEX','Service','service',NULL,NULL,false,true,NULL),
  ('ACONEX','Document Title','title',NULL,NULL,false,true,NULL),
  ('ACONEX','Revision','revision',NULL,NULL,false,true,NULL),
  ('ACONEX','Status','latest_status',NULL,NULL,false,true,NULL),
  ('ACONEX','Approval Status','approval_status_raw',NULL,NULL,false,true,NULL),
  ('ACONEX','Approval Date','stage:APPROVAL_DATE|as',NULL,'actual',false,true,'Aconex 권위 단계 실적')
ON CONFLICT DO NOTHING;

-- =========================
-- Seed: import presets
-- =========================
INSERT INTO public.spl_import_presets (mode, label, fields, sort_order)
SELECT 'hdec','계획일 일괄 갱신',
  ARRAY(SELECT 'stage:' || stage_code || '|ps' FROM public.spl_stage_catalog WHERE value_type <> 'flag' ORDER BY sort_order),
  10
WHERE NOT EXISTS (SELECT 1 FROM public.spl_import_presets WHERE mode = 'hdec');

INSERT INTO public.spl_import_presets (mode, label, fields, sort_order)
SELECT 'hdec','담당자만 갱신', ARRAY['team','pic','eng','pic_po','eng_po','supplier'], 20
WHERE NOT EXISTS (SELECT 1 FROM public.spl_import_presets WHERE mode = 'hdec' AND label = '담당자만 갱신');

INSERT INTO public.spl_import_presets (mode, label, fields, sort_order)
SELECT 'aconex','Aconex 기본 동기화', ARRAY['Document No','Revision','Status','Approval Status','Approval Date'], 10
WHERE NOT EXISTS (SELECT 1 FROM public.spl_import_presets WHERE mode = 'aconex');