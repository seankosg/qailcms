CREATE OR REPLACE FUNCTION public.task_auto_owner_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- 이름이 바뀌지 않았다면 기존 owner_user_id 유지
  IF TG_OP = 'UPDATE'
     AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'')
     AND COALESCE(NEW.hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'')
  THEN
    RETURN NEW;
  END IF;

  v_uid := NULL;
  IF NEW.hdec_pic_name IS NOT NULL AND NEW.hdec_pic_name <> '' THEN
    SELECT id INTO v_uid FROM public.profiles
      WHERE hdec_pic_name = NEW.hdec_pic_name LIMIT 1;
  END IF;
  IF v_uid IS NULL AND NEW.hdec_eng_name IS NOT NULL AND NEW.hdec_eng_name <> '' THEN
    SELECT id INTO v_uid FROM public.profiles
      WHERE hdec_eng_name = NEW.hdec_eng_name LIMIT 1;
  END IF;

  NEW.owner_user_id := v_uid;
  RETURN NEW;
END;
$$;

-- 이제 백필
UPDATE public.task_management_raw s
SET hdec_pic_name = m.hdec_pic_name
FROM public.task_management_raw m
WHERE s.level = 'sub'
  AND s.main_task_no IS NOT NULL
  AND (s.hdec_pic_name IS NULL OR s.hdec_pic_name = '')
  AND m.level = 'main'
  AND m.discipline = s.discipline
  AND m.task_no = s.main_task_no
  AND m.hdec_pic_name IS NOT NULL
  AND m.hdec_pic_name <> '';