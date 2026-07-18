CREATE OR REPLACE VIEW public.hdec_eng_master AS
SELECT id,
  COALESCE(NULLIF(btrim(hdec_eng_name),''), NULLIF(btrim(name),''), NULLIF(btrim(display_name),''), login_id) AS name,
  is_active, created_at, updated_at
FROM public.profiles
WHERE user_type IN ('pm_pd','hdec_eng','hdec_pic','hdec')
  AND is_active = true;

CREATE OR REPLACE VIEW public.hdec_pic_master AS
SELECT id,
  COALESCE(NULLIF(btrim(hdec_pic_name),''), NULLIF(btrim(name),''), NULLIF(btrim(display_name),''), login_id) AS name,
  is_active, created_at, updated_at
FROM public.profiles
WHERE user_type IN ('hdec','hdec_pic','pm_pd','hdec_eng')
  AND is_active = true;