
-- 1) 신규 컬럼 추가
ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS hdec_pic_name text,
  ADD COLUMN IF NOT EXISTS hdec_eng_name text;

-- 2) 백필: 한글 포함 → hdec_pic_name, 그 외 → hdec_eng_name
UPDATE public.task_management_raw
   SET hdec_pic_name = pic
 WHERE pic IS NOT NULL
   AND pic ~ '[가-힣]';

UPDATE public.task_management_raw
   SET hdec_eng_name = pic
 WHERE pic IS NOT NULL
   AND (pic !~ '[가-힣]');

-- 3) 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_tm_raw_hdec_pic ON public.task_management_raw (hdec_pic_name);
CREATE INDEX IF NOT EXISTS idx_tm_raw_hdec_eng ON public.task_management_raw (hdec_eng_name);

-- 4) 기존 pic 인덱스 및 컬럼 제거
DROP INDEX IF EXISTS public.idx_task_management_raw_pic;
ALTER TABLE public.task_management_raw DROP COLUMN IF EXISTS pic;

-- 5) profiles → task_management_raw 전파 트리거 재작성
CREATE OR REPLACE FUNCTION public.profiles_propagate_to_raw()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ABD: pic (단일 담당자 컬럼, HDEC PIC 이름 사용)
  IF NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.abd_items_raw
       SET pic = COALESCE(NEW.hdec_pic_name, NEW.name)
     WHERE owner_user_id = NEW.id
       AND pic IS DISTINCT FROM COALESCE(NEW.hdec_pic_name, NEW.name);
  END IF;

  -- Defect: hdec_pic_name / hdec_eng_name
  IF NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name THEN
    UPDATE public.defect_items_raw
       SET hdec_pic_name = NEW.hdec_pic_name
     WHERE owner_user_id = NEW.id
       AND COALESCE(hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'');
  END IF;
  IF NEW.hdec_eng_name IS DISTINCT FROM OLD.hdec_eng_name THEN
    UPDATE public.defect_items_raw
       SET hdec_eng_name = NEW.hdec_eng_name
     WHERE owner_user_id = NEW.id
       AND COALESCE(hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'');
  END IF;

  -- Task Management: hdec_pic_name / hdec_eng_name
  IF NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name THEN
    UPDATE public.task_management_raw
       SET hdec_pic_name = NEW.hdec_pic_name
     WHERE owner_user_id = NEW.id
       AND COALESCE(hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'');
  END IF;
  IF NEW.hdec_eng_name IS DISTINCT FROM OLD.hdec_eng_name THEN
    UPDATE public.task_management_raw
       SET hdec_eng_name = NEW.hdec_eng_name
     WHERE owner_user_id = NEW.id
       AND COALESCE(hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'');
  END IF;

  -- Spare Parts: issue_owner
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name THEN
    UPDATE public.spare_parts_raw
       SET issue_owner = COALESCE(NEW.hdec_pic_name, NEW.name)
     WHERE owner_user_id = NEW.id
       AND issue_owner IS DISTINCT FROM COALESCE(NEW.hdec_pic_name, NEW.name);
  END IF;

  RETURN NEW;
END $function$;

-- 6) 헤더 매핑 재바인딩: 기존 pic 매핑 제거 후 신규 필드로 등록
DELETE FROM public.task_management_header_mappings WHERE target_field = 'pic';

INSERT INTO public.task_management_header_mappings (module, source_header, target_field, is_custom, is_active)
VALUES
  ('task_management', '담당',        'hdec_pic_name', false, true),
  ('task_management', '담당자',      'hdec_pic_name', false, true),
  ('task_management', 'HDEC PIC',    'hdec_pic_name', false, true),
  ('task_management', 'PIC(한글)',   'hdec_pic_name', false, true),
  ('task_management', 'PIC 한글',    'hdec_pic_name', false, true),
  ('task_management', 'HDEC ENG',    'hdec_eng_name', false, true),
  ('task_management', 'PIC(영문)',   'hdec_eng_name', false, true),
  ('task_management', 'PIC 영문',    'hdec_eng_name', false, true),
  ('task_management', 'PIC (Eng)',   'hdec_eng_name', false, true),
  ('task_management', 'ENG',         'hdec_eng_name', false, true),
  ('task_management', 'Engineer',    'hdec_eng_name', false, true),
  ('task_management', 'PIC',         'hdec_eng_name', false, true)
ON CONFLICT DO NOTHING;

-- 7) Field Config: pic 제거, 신규 두 필드 등록
DELETE FROM public.task_management_field_config WHERE field_name = 'pic';

INSERT INTO public.task_management_field_config (field_name, display_name, group_key, sort_order, is_visible)
VALUES
  ('hdec_pic_name', 'HDEC PIC', 'task', 130, true),
  ('hdec_eng_name', 'HDEC ENG', 'task', 131, true)
ON CONFLICT (field_name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      group_key = EXCLUDED.group_key,
      sort_order = EXCLUDED.sort_order,
      is_visible = EXCLUDED.is_visible;
