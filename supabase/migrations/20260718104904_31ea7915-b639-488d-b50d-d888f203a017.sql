
CREATE OR REPLACE FUNCTION public.resolve_owner_by_name(_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_cnt int;
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_cnt FROM public.profiles
    WHERE user_type IN ('hdec_pic','hdec_eng','hdec','subcontractor','subsub')
      AND (btrim(name) = btrim(_name)
           OR btrim(hdec_pic_name) = btrim(_name)
           OR btrim(hdec_eng_name) = btrim(_name)
           OR btrim(subcontractor_name) = btrim(_name)
           OR btrim(subsub_name) = btrim(_name));
  IF v_cnt <> 1 THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.profiles
    WHERE user_type IN ('hdec_pic','hdec_eng','hdec','subcontractor','subsub')
      AND (btrim(name) = btrim(_name)
           OR btrim(hdec_pic_name) = btrim(_name)
           OR btrim(hdec_eng_name) = btrim(_name)
           OR btrim(subcontractor_name) = btrim(_name)
           OR btrim(subsub_name) = btrim(_name))
    LIMIT 1;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.defect_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_cnt int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'')
     AND COALESCE(NEW.hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'')
     AND COALESCE(NEW.subcontractor_name,'') = COALESCE(OLD.subcontractor_name,'')
     AND COALESCE(NEW.subsub_name,'') = COALESCE(OLD.subsub_name,'') THEN
    RETURN NEW;
  END IF;

  IF NEW.hdec_pic_name IS NOT NULL AND btrim(NEW.hdec_pic_name) <> '' THEN
    SELECT count(*) INTO v_cnt FROM public.profiles
      WHERE user_type IN ('hdec_pic','hdec')
        AND (btrim(name) = btrim(NEW.hdec_pic_name) OR btrim(hdec_pic_name) = btrim(NEW.hdec_pic_name));
    IF v_cnt = 1 THEN
      SELECT id INTO v_id FROM public.profiles
        WHERE user_type IN ('hdec_pic','hdec')
          AND (btrim(name) = btrim(NEW.hdec_pic_name) OR btrim(hdec_pic_name) = btrim(NEW.hdec_pic_name))
        LIMIT 1;
      NEW.owner_user_id := v_id; RETURN NEW;
    END IF;
  END IF;

  IF NEW.hdec_eng_name IS NOT NULL AND btrim(NEW.hdec_eng_name) <> '' THEN
    SELECT count(*) INTO v_cnt FROM public.profiles
      WHERE user_type IN ('hdec_eng','hdec')
        AND (btrim(name) = btrim(NEW.hdec_eng_name) OR btrim(hdec_eng_name) = btrim(NEW.hdec_eng_name));
    IF v_cnt = 1 THEN
      SELECT id INTO v_id FROM public.profiles
        WHERE user_type IN ('hdec_eng','hdec')
          AND (btrim(name) = btrim(NEW.hdec_eng_name) OR btrim(hdec_eng_name) = btrim(NEW.hdec_eng_name))
        LIMIT 1;
      NEW.owner_user_id := v_id; RETURN NEW;
    END IF;
  END IF;

  IF NEW.subcontractor_name IS NOT NULL AND btrim(NEW.subcontractor_name) <> '' THEN
    SELECT count(*) INTO v_cnt FROM public.profiles
      WHERE user_type = 'subcontractor' AND btrim(subcontractor_name) = btrim(NEW.subcontractor_name);
    IF v_cnt = 1 THEN
      SELECT id INTO v_id FROM public.profiles
        WHERE user_type = 'subcontractor' AND btrim(subcontractor_name) = btrim(NEW.subcontractor_name) LIMIT 1;
      NEW.owner_user_id := v_id; RETURN NEW;
    END IF;
  END IF;

  IF NEW.subsub_name IS NOT NULL AND btrim(NEW.subsub_name) <> '' THEN
    SELECT count(*) INTO v_cnt FROM public.profiles
      WHERE user_type = 'subsub' AND btrim(subsub_name) = btrim(NEW.subsub_name);
    IF v_cnt = 1 THEN
      SELECT id INTO v_id FROM public.profiles
        WHERE user_type = 'subsub' AND btrim(subsub_name) = btrim(NEW.subsub_name) LIMIT 1;
      NEW.owner_user_id := v_id; RETURN NEW;
    END IF;
  END IF;

  NEW.owner_user_id := NULL;
  RETURN NEW;
END $$;
