
-- 1. task_management_field_config
CREATE TABLE public.task_management_field_config (
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_management_field_config TO authenticated;
GRANT ALL ON public.task_management_field_config TO service_role;

ALTER TABLE public.task_management_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TM field config select for auth"
  ON public.task_management_field_config FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "TM field config admin manage"
  ON public.task_management_field_config FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_tm_field_config_updated_at
  BEFORE UPDATE ON public.task_management_field_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. task_management_header_mappings
CREATE TABLE public.task_management_header_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL DEFAULT 'task_management',
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_management_header_mappings TO authenticated;
GRANT ALL ON public.task_management_header_mappings TO service_role;

ALTER TABLE public.task_management_header_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TM header mapping select for auth"
  ON public.task_management_header_mappings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "TM header mapping admin manage"
  ON public.task_management_header_mappings FOR ALL
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_tm_header_mappings_updated_at
  BEFORE UPDATE ON public.task_management_header_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Seed field config for TM_COLUMNS
INSERT INTO public.task_management_field_config (field_name, display_name, sort_order, group_key)
VALUES
  ('task_no','Task No',10,'id'),
  ('level','Level',20,'id'),
  ('discipline','공종',30,'id'),
  ('category','Category',40,'task'),
  ('plot','Plot',50,'task'),
  ('task_name','항목',60,'task'),
  ('risk','리스크',70,'task'),
  ('sub_task_desc','세부 업무',80,'task'),
  ('pic','담당',90,'task'),
  ('row_type','유형',100,'task'),
  ('status_manual','상태',110,'status'),
  ('auto_judgment','자동 판정',120,'status'),
  ('plan_start','계획 시작',130,'plan'),
  ('plan_end','계획 완료',140,'plan'),
  ('plan_days','계획 일수',150,'plan'),
  ('actual_start','실제 시작',160,'actual'),
  ('actual_progress','실적 진도율',170,'actual'),
  ('plan_progress','계획 진도율',180,'forecast'),
  ('progress_variance','진도차(%p)',190,'forecast'),
  ('expected_progress_today','오늘 계획',200,'forecast'),
  ('today_gap','오늘 차이',210,'forecast'),
  ('forecast_end','예상 완료',220,'forecast'),
  ('slip_days','차이(일)',230,'forecast'),
  ('data_date','Data Date',240,'system'),
  ('source_file','Source File',250,'system'),
  ('imported_at','Imported',260,'system')
ON CONFLICT (field_name) DO NOTHING;

-- 4. Seed default header mappings (label -> key) for TM
INSERT INTO public.task_management_header_mappings (module, source_header, target_field, is_custom)
VALUES
  ('task_management','Task No','task_no',false),
  ('task_management','Level','level',false),
  ('task_management','공종','discipline',false),
  ('task_management','Category','category',false),
  ('task_management','Plot','plot',false),
  ('task_management','항목','task_name',false),
  ('task_management','리스크','risk',false),
  ('task_management','세부 업무','sub_task_desc',false),
  ('task_management','담당','pic',false),
  ('task_management','유형','row_type',false),
  ('task_management','상태','status_manual',false),
  ('task_management','자동 판정','auto_judgment',false),
  ('task_management','계획 시작','plan_start',false),
  ('task_management','계획 완료','plan_end',false),
  ('task_management','계획 일수','plan_days',false),
  ('task_management','실제 시작','actual_start',false),
  ('task_management','실적 진도율','actual_progress',false),
  ('task_management','계획 진도율','plan_progress',false),
  ('task_management','진도차(%p)','progress_variance',false),
  ('task_management','오늘 계획','expected_progress_today',false),
  ('task_management','오늘 차이','today_gap',false),
  ('task_management','예상 완료','forecast_end',false),
  ('task_management','차이(일)','slip_days',false),
  ('task_management','Data Date','data_date',false),
  ('task_management','Source File','source_file',false)
ON CONFLICT (module, source_header) DO NOTHING;
