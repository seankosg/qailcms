
-- 기존 통합 트리거 제거
DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.abd_items_raw;
DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.defect_items_raw;
DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.spare_parts_raw;
DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.task_management_raw;
DROP FUNCTION IF EXISTS public.auto_set_owner_user_id();

-- =========================================================================
-- 공용 헬퍼: 이름 하나로 유일 매칭되는 사용자 id 반환
-- =========================================================================
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
  SELECT count(*), min(id) INTO v_cnt, v_id
    FROM public.profiles
    WHERE user_type IN ('hdec_pic','hdec_eng','hdec','subcontractor','subsub')
      AND (btrim(name) = btrim(_name)
           OR btrim(hdec_pic_name) = btrim(_name)
           OR btrim(hdec_eng_name) = btrim(_name)
           OR btrim(subcontractor_name) = btrim(_name)
           OR btrim(subsub_name) = btrim(_name));
  IF v_cnt = 1 THEN RETURN v_id; END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_owner_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_owner_by_name(text) TO authenticated;

-- =========================================================================
-- ABD: pic 컬럼 하나 사용
-- =========================================================================
CREATE OR REPLACE FUNCTION public.abd_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := public.resolve_owner_by_name(NEW.pic);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.abd_auto_owner_user_id();

-- =========================================================================
-- Task Management: pic 컬럼 하나 사용
-- =========================================================================
CREATE OR REPLACE FUNCTION public.task_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := public.resolve_owner_by_name(NEW.pic);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.task_management_raw
  FOR EACH ROW EXECUTE FUNCTION public.task_auto_owner_user_id();

-- =========================================================================
-- Spare Parts: issue_owner 컬럼 사용
-- =========================================================================
CREATE OR REPLACE FUNCTION public.spare_parts_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.issue_owner,'') = COALESCE(OLD.issue_owner,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := public.resolve_owner_by_name(NEW.issue_owner);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.spare_parts_raw
  FOR EACH ROW EXECUTE FUNCTION public.spare_parts_auto_owner_user_id();

-- =========================================================================
-- Defect: hdec_pic_name / hdec_eng_name / subcontractor_name / subsub_name
-- =========================================================================
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
    SELECT count(*), min(id) INTO v_cnt, v_id FROM public.profiles
      WHERE user_type IN ('hdec_pic','hdec')
        AND (btrim(name) = btrim(NEW.hdec_pic_name) OR btrim(hdec_pic_name) = btrim(NEW.hdec_pic_name));
    IF v_cnt = 1 THEN NEW.owner_user_id := v_id; RETURN NEW; END IF;
  END IF;

  IF NEW.hdec_eng_name IS NOT NULL AND btrim(NEW.hdec_eng_name) <> '' THEN
    SELECT count(*), min(id) INTO v_cnt, v_id FROM public.profiles
      WHERE user_type IN ('hdec_eng','hdec')
        AND (btrim(name) = btrim(NEW.hdec_eng_name) OR btrim(hdec_eng_name) = btrim(NEW.hdec_eng_name));
    IF v_cnt = 1 THEN NEW.owner_user_id := v_id; RETURN NEW; END IF;
  END IF;

  IF NEW.subcontractor_name IS NOT NULL AND btrim(NEW.subcontractor_name) <> '' THEN
    SELECT count(*), min(id) INTO v_cnt, v_id FROM public.profiles
      WHERE user_type = 'subcontractor' AND btrim(subcontractor_name) = btrim(NEW.subcontractor_name);
    IF v_cnt = 1 THEN NEW.owner_user_id := v_id; RETURN NEW; END IF;
  END IF;

  IF NEW.subsub_name IS NOT NULL AND btrim(NEW.subsub_name) <> '' THEN
    SELECT count(*), min(id) INTO v_cnt, v_id FROM public.profiles
      WHERE user_type = 'subsub' AND btrim(subsub_name) = btrim(NEW.subsub_name);
    IF v_cnt = 1 THEN NEW.owner_user_id := v_id; RETURN NEW; END IF;
  END IF;

  NEW.owner_user_id := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.defect_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.defect_auto_owner_user_id();

-- =========================================================================
-- is_row_owner: 인자를 유지하되 nullable로 사용 (ABD/Task는 hdec_pic만 사용, subsub NULL 전달 등)
-- 기존 함수 재정의 (동일 시그니처)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_row_owner(
  _user_id uuid,
  _owner_user_id uuid,
  _hdec_pic text,
  _hdec_eng text,
  _subcon text,
  _subsub text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.user_type;
  v_name text;
  v_hdec_pic text;
  v_hdec_eng text;
  v_subcon text;
  v_subsub text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF _owner_user_id IS NOT NULL AND _owner_user_id = _user_id THEN RETURN true; END IF;

  SELECT user_type, name, hdec_pic_name, hdec_eng_name, subcontractor_name, subsub_name
    INTO v_type, v_name, v_hdec_pic, v_hdec_eng, v_subcon, v_subsub
    FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- name 매칭: hdec_pic / hdec_eng 사용자는 profile.name 이 owner 이름과 일치
  IF v_type = 'hdec_pic' AND v_name IS NOT NULL THEN
    IF _hdec_pic IS NOT NULL AND btrim(v_name) = btrim(_hdec_pic) THEN RETURN true; END IF;
    IF _hdec_eng IS NOT NULL AND btrim(v_name) = btrim(_hdec_eng) THEN RETURN true; END IF;
  END IF;
  IF v_type = 'hdec_eng' AND v_name IS NOT NULL THEN
    IF _hdec_eng IS NOT NULL AND btrim(v_name) = btrim(_hdec_eng) THEN RETURN true; END IF;
    IF _hdec_pic IS NOT NULL AND btrim(v_name) = btrim(_hdec_pic) THEN RETURN true; END IF;
  END IF;

  IF v_type = 'subcontractor' AND v_subcon IS NOT NULL AND _subcon IS NOT NULL
     AND btrim(v_subcon) = btrim(_subcon) THEN RETURN true; END IF;

  IF v_type = 'subsub' AND v_subsub IS NOT NULL AND _subsub IS NOT NULL
     AND btrim(v_subsub) = btrim(_subsub) THEN RETURN true; END IF;

  IF v_type = 'hdec' THEN
    IF v_hdec_pic IS NOT NULL AND _hdec_pic IS NOT NULL
       AND btrim(v_hdec_pic) = btrim(_hdec_pic) THEN RETURN true; END IF;
    IF v_hdec_eng IS NOT NULL AND _hdec_eng IS NOT NULL
       AND btrim(v_hdec_eng) = btrim(_hdec_eng) THEN RETURN true; END IF;
  END IF;

  RETURN false;
END $$;
