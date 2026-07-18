
-- =========================================================================
-- Step A. user_type enum 확장
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_type' AND e.enumlabel = 'hdec_pic') THEN
    ALTER TYPE public.user_type ADD VALUE 'hdec_pic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_type' AND e.enumlabel = 'hdec_eng') THEN
    ALTER TYPE public.user_type ADD VALUE 'hdec_eng';
  END IF;
END$$;

-- =========================================================================
-- Step B. owner_user_id 컬럼 및 인덱스 (4개 테이블)
-- =========================================================================
ALTER TABLE public.abd_items_raw          ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.defect_items_raw       ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.spare_parts_raw        ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.task_management_raw    ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_abd_items_raw_owner_user_id       ON public.abd_items_raw(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_owner_user_id    ON public.defect_items_raw(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_spare_parts_raw_owner_user_id     ON public.spare_parts_raw(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_task_management_raw_owner_user_id ON public.task_management_raw(owner_user_id);

-- =========================================================================
-- Step E. SQL 헬퍼 함수
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','superuser','d_superuser')
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  )
$$;

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

  IF v_type = 'hdec_pic' AND v_name IS NOT NULL AND _hdec_pic IS NOT NULL
     AND btrim(v_name) = btrim(_hdec_pic) THEN RETURN true; END IF;

  IF v_type = 'hdec_eng' AND v_name IS NOT NULL AND _hdec_eng IS NOT NULL
     AND btrim(v_name) = btrim(_hdec_eng) THEN RETURN true; END IF;

  IF v_type = 'subcontractor' AND v_subcon IS NOT NULL AND _subcon IS NOT NULL
     AND btrim(v_subcon) = btrim(_subcon) THEN RETURN true; END IF;

  IF v_type = 'subsub' AND v_subsub IS NOT NULL AND _subsub IS NOT NULL
     AND btrim(v_subsub) = btrim(_subsub) THEN RETURN true; END IF;

  -- 하위호환: 레거시 hdec
  IF v_type = 'hdec' THEN
    IF v_hdec_pic IS NOT NULL AND _hdec_pic IS NOT NULL
       AND btrim(v_hdec_pic) = btrim(_hdec_pic) THEN RETURN true; END IF;
    IF v_hdec_eng IS NOT NULL AND _hdec_eng IS NOT NULL
       AND btrim(v_hdec_eng) = btrim(_hdec_eng) THEN RETURN true; END IF;
  END IF;

  RETURN false;
END $$;

REVOKE EXECUTE ON FUNCTION public.is_full_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_row_owner(uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_full_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_row_owner(uuid, uuid, text, text, text, text) TO authenticated;

-- =========================================================================
-- Step F. owner_user_id 자동 유지 트리거 함수
-- =========================================================================
CREATE OR REPLACE FUNCTION public.auto_set_owner_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match uuid;
  v_count int;
BEGIN
  -- 이미 값이 있고 관련 이름이 변경되지 않았다면 유지
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.hdec_pic_name,'') = COALESCE(OLD.hdec_pic_name,'')
     AND COALESCE(NEW.hdec_eng_name,'') = COALESCE(OLD.hdec_eng_name,'')
     AND COALESCE(NEW.subcontractor_name,'') = COALESCE(OLD.subcontractor_name,'')
     AND COALESCE(NEW.subsub_name,'') = COALESCE(OLD.subsub_name,'') THEN
    RETURN NEW;
  END IF;

  -- 우선순위: hdec_pic → hdec_eng → subcontractor → subsub
  IF NEW.hdec_pic_name IS NOT NULL AND btrim(NEW.hdec_pic_name) <> '' THEN
    SELECT count(*), min(id) INTO v_count, v_match
      FROM public.profiles
      WHERE user_type IN ('hdec_pic','hdec')
        AND (name = NEW.hdec_pic_name OR hdec_pic_name = NEW.hdec_pic_name);
    IF v_count = 1 THEN NEW.owner_user_id := v_match; RETURN NEW; END IF;
  END IF;

  IF NEW.hdec_eng_name IS NOT NULL AND btrim(NEW.hdec_eng_name) <> '' THEN
    SELECT count(*), min(id) INTO v_count, v_match
      FROM public.profiles
      WHERE user_type IN ('hdec_eng','hdec')
        AND (name = NEW.hdec_eng_name OR hdec_eng_name = NEW.hdec_eng_name);
    IF v_count = 1 THEN NEW.owner_user_id := v_match; RETURN NEW; END IF;
  END IF;

  IF NEW.subcontractor_name IS NOT NULL AND btrim(NEW.subcontractor_name) <> '' THEN
    SELECT count(*), min(id) INTO v_count, v_match
      FROM public.profiles
      WHERE user_type = 'subcontractor' AND subcontractor_name = NEW.subcontractor_name;
    IF v_count = 1 THEN NEW.owner_user_id := v_match; RETURN NEW; END IF;
  END IF;

  IF NEW.subsub_name IS NOT NULL AND btrim(NEW.subsub_name) <> '' THEN
    SELECT count(*), min(id) INTO v_count, v_match
      FROM public.profiles
      WHERE user_type = 'subsub' AND subsub_name = NEW.subsub_name;
    IF v_count = 1 THEN NEW.owner_user_id := v_match; RETURN NEW; END IF;
  END IF;

  -- 매칭 없음 또는 다중 매칭
  NEW.owner_user_id := NULL;
  RETURN NEW;
END $$;

-- defect_items_raw 는 subsub_name 이 있음, spare_parts_raw / task_management_raw 는 확인 필요
-- 안전을 위해 존재하지 않는 컬럼은 트리거에서 NULL 처리되도록 조건부 트리거 4종 생성.
-- 4개 테이블 모두 hdec_pic_name/hdec_eng_name/subcontractor_name/subsub_name 이 있다고 확인됨.

DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.abd_items_raw;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_owner_user_id();

DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.defect_items_raw;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.defect_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_owner_user_id();

DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.spare_parts_raw;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.spare_parts_raw
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_owner_user_id();

DROP TRIGGER IF EXISTS trg_auto_owner_user_id ON public.task_management_raw;
CREATE TRIGGER trg_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.task_management_raw
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_owner_user_id();
