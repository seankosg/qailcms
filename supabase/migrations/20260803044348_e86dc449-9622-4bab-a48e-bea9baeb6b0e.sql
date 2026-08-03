CREATE OR REPLACE FUNCTION public.profiles_propagate_to_raw()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ABD
  IF NEW.hdec_pic_name IS DISTINCT FROM OLD.hdec_pic_name OR NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.abd_items_raw
       SET hdec_pic_name = COALESCE(NEW.hdec_pic_name, NEW.name)
     WHERE owner_user_id = NEW.id
       AND hdec_pic_name IS DISTINCT FROM COALESCE(NEW.hdec_pic_name, NEW.name);
  END IF;

  -- Defect
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

  -- Task Management
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

  RETURN NEW;
END $function$;