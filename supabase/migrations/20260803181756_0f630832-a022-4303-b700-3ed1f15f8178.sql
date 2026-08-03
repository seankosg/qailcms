-- 1) 이름 필수 + 정규화 생성 컬럼 + 유일 인덱스
ALTER TABLE public.profiles ALTER COLUMN name SET NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS name_norm text
  GENERATED ALWAYS AS (upper(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_name_norm_key ON public.profiles (name_norm);

-- 2) 단일 정본 함수
CREATE OR REPLACE FUNCTION public.resolve_user_by_name(_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
  v_id uuid;
  v_cnt int;
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN RETURN NULL; END IF;
  v_norm := upper(regexp_replace(btrim(_name), '\s+', ' ', 'g'));
  SELECT count(*) INTO v_cnt FROM public.profiles WHERE name_norm = v_norm;
  IF v_cnt <> 1 THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.profiles WHERE name_norm = v_norm;
  RETURN v_id;
END $function$;

-- 3) 기존 진입점을 정본 함수로 위임 (user_type / is_active 필터 제거)
CREATE OR REPLACE FUNCTION public.resolve_owner_by_name(_name text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.resolve_user_by_name(_name);
$function$;

-- 4) 모듈 트리거 통일
CREATE OR REPLACE FUNCTION public.task_auto_owner_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'')
     AND COALESCE(NEW.hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'')
  THEN
    RETURN NEW;
  END IF;

  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.hdec_pic_name,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.hdec_eng_name,'')), ''))
  );
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.abd_auto_owner_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_name text;
  old_name text;
BEGIN
  new_name := COALESCE(NULLIF(NEW.hdec_pic_name, ''), NEW.hdec_eng_name);
  IF TG_OP = 'UPDATE' THEN
    old_name := COALESCE(NULLIF(OLD.hdec_pic_name, ''), OLD.hdec_eng_name);
    IF NEW.owner_user_id IS NOT NULL AND COALESCE(new_name,'') = COALESCE(old_name,'') THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.owner_user_id := public.resolve_user_by_name(new_name);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.defect_auto_owner_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'')
     AND COALESCE(NEW.hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'')
     AND COALESCE(NEW.subcontractor_name,'') = COALESCE(OLD.subcontractor_name,'')
     AND COALESCE(NEW.subsub_name,'') = COALESCE(OLD.subsub_name,'') THEN
    RETURN NEW;
  END IF;

  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.hdec_pic_name,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.hdec_eng_name,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.subcontractor_name,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.subsub_name,'')), ''))
  );
  RETURN NEW;
END $function$;

-- 5) 소유자 판정 통일 (사람 이름은 name_norm 단독, 업체명은 업체 컬럼 유지)
CREATE OR REPLACE FUNCTION public.is_row_owner(_user_id uuid, _owner_user_id uuid, _hdec_pic text, _hdec_eng text, _subcon text, _subsub text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type public.user_type;
  v_subcon text;
  v_subsub text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _owner_user_id IS NOT NULL AND _owner_user_id = _user_id THEN RETURN true; END IF;

  SELECT user_type, subcontractor_name, subsub_name
    INTO v_type, v_subcon, v_subsub
    FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF public.resolve_user_by_name(_hdec_pic) = _user_id THEN RETURN true; END IF;
  IF public.resolve_user_by_name(_hdec_eng) = _user_id THEN RETURN true; END IF;

  IF v_type = 'subcontractor' AND v_subcon IS NOT NULL AND _subcon IS NOT NULL
     AND upper(btrim(v_subcon)) = upper(btrim(_subcon)) THEN RETURN true; END IF;

  IF v_type = 'subsub' AND v_subsub IS NOT NULL AND _subsub IS NOT NULL
     AND upper(btrim(v_subsub)) = upper(btrim(_subsub)) THEN RETURN true; END IF;

  RETURN false;
END $function$;

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
    IF public.resolve_user_by_name(v_row_json->>'hdec_pic_name') = _user_id THEN RETURN true; END IF;
    IF public.resolve_user_by_name(v_row_json->>'hdec_eng_name') = _user_id THEN RETURN true; END IF;
    IF public.resolve_user_by_name(v_row_json->>'pic') = _user_id THEN RETURN true; END IF;

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
END $function$;

-- 6) 명부 뷰: 4단 COALESCE → name 단독
CREATE OR REPLACE VIEW public.hdec_pic_master AS
  SELECT p.id, btrim(p.name) AS name, p.is_active, p.created_at, p.updated_at
  FROM public.profiles p
  WHERE p.user_type = ANY (ARRAY['hdec'::user_type, 'hdec_pic'::user_type, 'pm_pd'::user_type, 'hdec_eng'::user_type])
    AND p.is_active = true
  UNION ALL
  SELECT m.id, m.name, m.is_active, m.created_at, m.updated_at
  FROM public.hdec_pic_name_master m
  WHERE m.is_active = true;

CREATE OR REPLACE VIEW public.hdec_eng_master AS
  SELECT p.id, btrim(p.name) AS name, p.is_active, p.created_at, p.updated_at
  FROM public.profiles p
  WHERE p.user_type = ANY (ARRAY['pm_pd'::user_type, 'hdec_eng'::user_type, 'hdec_pic'::user_type, 'hdec'::user_type])
    AND p.is_active = true
  UNION ALL
  SELECT m.id, m.name, m.is_active, m.created_at, m.updated_at
  FROM public.hdec_eng_name_master m
  WHERE m.is_active = true;