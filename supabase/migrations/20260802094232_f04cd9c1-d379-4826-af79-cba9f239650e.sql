CREATE OR REPLACE FUNCTION public.can_edit_row(_user_id uuid, _table_name text, _row_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_highest_rank public.app_role;
  v_row_json jsonb;
BEGIN
  IF _table_name !~ '^[a-z_]+$' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT role INTO v_highest_rank
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 7
    WHEN 'superuser' THEN 6
    WHEN 'd_superuser' THEN 5
    WHEN 'senior_user' THEN 4
    WHEN 'user' THEN 3
    WHEN 'super_guest' THEN 2
    WHEN 'guest' THEN 1
  END DESC
  LIMIT 1;

  IF v_highest_rank IS NULL THEN
    RETURN false;
  END IF;

  IF v_highest_rank IN ('admin', 'superuser') THEN
    RETURN true;
  END IF;

  -- QAQC 팀 HDEC PIC/ENG 은 admin/superuser 를 제외하고 항상 읽기 전용 (다른 모든 조건 override)
  IF upper(trim(coalesce(v_profile.team, ''))) = 'QAQC'
     AND v_profile.user_type IN ('hdec_pic', 'hdec_eng') THEN
    RETURN false;
  END IF;

  IF v_highest_rank = 'senior_user' THEN
    RETURN true;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', _table_name)
    INTO v_row_json USING _row_id;

  IF v_highest_rank = 'd_superuser' THEN
    IF v_profile.team IS NOT NULL AND v_row_json->>'team' IS NOT NULL
       AND upper(trim(v_profile.team)) = upper(trim(v_row_json->>'team')) THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF v_highest_rank = 'user' THEN
    IF v_profile.user_type IN ('hdec', 'pm_pd', 'admin') THEN
      IF v_profile.hdec_pic_name IS NOT NULL AND v_row_json->>'hdec_pic_name' IS NOT NULL
         AND upper(trim(v_profile.hdec_pic_name)) = upper(trim(v_row_json->>'hdec_pic_name')) THEN
        RETURN true;
      END IF;
      IF v_profile.hdec_eng_name IS NOT NULL AND v_row_json->>'hdec_eng_name' IS NOT NULL
         AND upper(trim(v_profile.hdec_eng_name)) = upper(trim(v_row_json->>'hdec_eng_name')) THEN
        RETURN true;
      END IF;
      IF v_profile.name IS NOT NULL AND v_row_json->>'pic' IS NOT NULL
         AND upper(trim(v_profile.name)) = upper(trim(v_row_json->>'pic')) THEN
        RETURN true;
      END IF;
    END IF;

    IF v_profile.user_type = 'subcontractor' AND v_profile.subcontractor_name IS NOT NULL
       AND v_row_json->>'subcontractor_name' IS NOT NULL
       AND upper(trim(v_profile.subcontractor_name)) = upper(trim(v_row_json->>'subcontractor_name')) THEN
      RETURN true;
    END IF;

    IF v_profile.user_type = 'subsub' AND v_profile.subsub_name IS NOT NULL
       AND v_row_json->>'subsub_name' IS NOT NULL
       AND upper(trim(v_profile.subsub_name)) = upper(trim(v_row_json->>'subsub_name')) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_qaqc_readonly(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND upper(trim(coalesce(p.team, ''))) = 'QAQC'
      AND p.user_type IN ('hdec_pic', 'hdec_eng')
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role IN ('admin', 'superuser')
      )
  )
$function$;

GRANT EXECUTE ON FUNCTION public.is_qaqc_readonly(uuid) TO authenticated;