CREATE OR REPLACE VIEW public.hdec_pic_master AS
SELECT
  id,
  COALESCE(
    NULLIF(btrim(hdec_pic_name), ''),
    NULLIF(btrim(name), ''),
    NULLIF(btrim(display_name), ''),
    login_id
  ) AS name,
  is_active,
  created_at,
  updated_at
FROM public.profiles p
WHERE user_type IN ('hdec'::user_type, 'hdec_pic'::user_type)
  AND is_active = true;

CREATE OR REPLACE VIEW public.hdec_eng_master AS
SELECT
  id,
  COALESCE(
    NULLIF(btrim(hdec_eng_name), ''),
    NULLIF(btrim(name), ''),
    NULLIF(btrim(display_name), ''),
    login_id
  ) AS name,
  is_active,
  created_at,
  updated_at
FROM public.profiles p
WHERE user_type IN ('pm_pd'::user_type, 'hdec_eng'::user_type)
  AND is_active = true;