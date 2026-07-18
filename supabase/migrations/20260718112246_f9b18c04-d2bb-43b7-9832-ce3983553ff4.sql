
-- 프로필의 이름/HDEC PIC/HDEC ENG 필드 변경 시 상호 및 Raw Data 연동

CREATE OR REPLACE FUNCTION public.profiles_sync_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_name text := COALESCE(OLD.name, '');
  v_new_name text := COALESCE(NEW.name, '');
  v_old_pic  text := COALESCE(OLD.hdec_pic_name, '');
  v_new_pic  text := COALESCE(NEW.hdec_pic_name, '');
  v_old_eng  text := COALESCE(OLD.hdec_eng_name, '');
  v_new_eng  text := COALESCE(NEW.hdec_eng_name, '');
BEGIN
  -- ===== 1) profiles 내부 상호 연동 (이전에 값이 같았던 필드는 함께 이동) =====
  IF v_old_name IS DISTINCT FROM v_new_name THEN
    IF v_old_pic = v_old_name AND NEW.hdec_pic_name IS NOT DISTINCT FROM OLD.hdec_pic_name THEN
      NEW.hdec_pic_name := NEW.name;
      v_new_pic := COALESCE(NEW.hdec_pic_name, '');
    END IF;
    IF v_old_eng = v_old_name AND NEW.hdec_eng_name IS NOT DISTINCT FROM OLD.hdec_eng_name THEN
      NEW.hdec_eng_name := NEW.name;
      v_new_eng := COALESCE(NEW.hdec_eng_name, '');
    END IF;
  END IF;

  IF v_old_pic IS DISTINCT FROM v_new_pic THEN
    IF v_old_name = v_old_pic AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
      NEW.name := NEW.hdec_pic_name;
      v_new_name := COALESCE(NEW.name, '');
    END IF;
    IF v_old_eng = v_old_pic AND NEW.hdec_eng_name IS NOT DISTINCT FROM OLD.hdec_eng_name THEN
      NEW.hdec_eng_name := NEW.hdec_pic_name;
      v_new_eng := COALESCE(NEW.hdec_eng_name, '');
    END IF;
  END IF;

  IF v_old_eng IS DISTINCT FROM v_new_eng THEN
    IF v_old_name = v_old_eng AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
      NEW.name := NEW.hdec_eng_name;
      v_new_name := COALESCE(NEW.name, '');
    END IF;
    IF v_old_pic = v_old_eng AND NEW.hdec_pic_name IS NOT DISTINCT FROM OLD.hdec_pic_name THEN
      NEW.hdec_pic_name := NEW.hdec_eng_name;
      v_new_pic := COALESCE(NEW.hdec_pic_name, '');
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_sync_names ON public.profiles;
CREATE TRIGGER trg_profiles_sync_names
BEFORE UPDATE OF name, hdec_pic_name, hdec_eng_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_sync_names();


-- ===== 2) profiles 변경 시 Raw Data의 담당자 문자열 전파 (owner_user_id 기준) =====
CREATE OR REPLACE FUNCTION public.profiles_propagate_to_raw()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Task Management: pic
  IF NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.task_management_raw
       SET pic = COALESCE(NEW.hdec_pic_name, NEW.name)
     WHERE owner_user_id = NEW.id
       AND pic IS DISTINCT FROM COALESCE(NEW.hdec_pic_name, NEW.name);
  END IF;

  -- Spare Parts: issue_owner
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name THEN
    UPDATE public.spare_parts_raw
       SET issue_owner = COALESCE(NEW.hdec_pic_name, NEW.name)
     WHERE owner_user_id = NEW.id
       AND issue_owner IS DISTINCT FROM COALESCE(NEW.hdec_pic_name, NEW.name);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_propagate_to_raw ON public.profiles;
CREATE TRIGGER trg_profiles_propagate_to_raw
AFTER UPDATE OF name, hdec_pic_name, hdec_eng_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_propagate_to_raw();
