
-- HDEC PIC / HDEC ENG 이름 마스터 테이블 신설
-- 기존 hdec_pic_master / hdec_eng_master 는 profiles 기반 뷰였음. 이름만 등록하고 싶은 케이스(임포트 매핑 다이얼로그)를
-- 지원하기 위해 별도 name-only 테이블을 만들고, 뷰가 profiles + name-only 를 UNION 하도록 재정의.

CREATE TABLE IF NOT EXISTS public.hdec_pic_name_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hdec_pic_name_master_name_key UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hdec_pic_name_master TO authenticated;
GRANT ALL ON public.hdec_pic_name_master TO service_role;
ALTER TABLE public.hdec_pic_name_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read hdec_pic_name_master" ON public.hdec_pic_name_master;
CREATE POLICY "read hdec_pic_name_master" ON public.hdec_pic_name_master FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage hdec_pic_name_master" ON public.hdec_pic_name_master;
CREATE POLICY "admin manage hdec_pic_name_master" ON public.hdec_pic_name_master FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]));

CREATE TABLE IF NOT EXISTS public.hdec_eng_name_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hdec_eng_name_master_name_key UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hdec_eng_name_master TO authenticated;
GRANT ALL ON public.hdec_eng_name_master TO service_role;
ALTER TABLE public.hdec_eng_name_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read hdec_eng_name_master" ON public.hdec_eng_name_master;
CREATE POLICY "read hdec_eng_name_master" ON public.hdec_eng_name_master FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage hdec_eng_name_master" ON public.hdec_eng_name_master;
CREATE POLICY "admin manage hdec_eng_name_master" ON public.hdec_eng_name_master FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser','d_superuser']::app_role[]));

-- 뷰 재정의: profiles 기반 이름 + name-only 마스터 UNION
DROP VIEW IF EXISTS public.hdec_pic_master;
CREATE VIEW public.hdec_pic_master AS
  SELECT
    id,
    COALESCE(NULLIF(btrim(hdec_pic_name), ''), NULLIF(btrim(name), ''), NULLIF(btrim(display_name), ''), login_id) AS name,
    is_active,
    created_at,
    updated_at
  FROM public.profiles
  WHERE user_type = ANY (ARRAY['hdec'::user_type, 'hdec_pic'::user_type, 'pm_pd'::user_type, 'hdec_eng'::user_type])
    AND is_active = true
  UNION ALL
  SELECT id, name, is_active, created_at, updated_at
  FROM public.hdec_pic_name_master
  WHERE is_active = true;
GRANT SELECT ON public.hdec_pic_master TO authenticated;

DROP VIEW IF EXISTS public.hdec_eng_master;
CREATE VIEW public.hdec_eng_master AS
  SELECT
    id,
    COALESCE(NULLIF(btrim(hdec_eng_name), ''), NULLIF(btrim(name), ''), NULLIF(btrim(display_name), ''), login_id) AS name,
    is_active,
    created_at,
    updated_at
  FROM public.profiles
  WHERE user_type = ANY (ARRAY['pm_pd'::user_type, 'hdec_eng'::user_type, 'hdec_pic'::user_type, 'hdec'::user_type])
    AND is_active = true
  UNION ALL
  SELECT id, name, is_active, created_at, updated_at
  FROM public.hdec_eng_name_master
  WHERE is_active = true;
GRANT SELECT ON public.hdec_eng_master TO authenticated;
