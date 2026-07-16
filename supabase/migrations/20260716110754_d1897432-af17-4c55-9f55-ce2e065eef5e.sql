DROP TABLE IF EXISTS public.hdec_pic_master CASCADE;
DROP TABLE IF EXISTS public.hdec_eng_master CASCADE;

CREATE VIEW public.hdec_pic_master
WITH (security_invoker = true)
AS
SELECT
  p.id,
  COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(p.display_name), ''), p.login_id) AS name,
  p.is_active,
  p.created_at,
  p.updated_at
FROM public.profiles p
WHERE p.user_type = 'hdec' AND p.is_active = true;

CREATE VIEW public.hdec_eng_master
WITH (security_invoker = true)
AS
SELECT
  p.id,
  COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(p.display_name), ''), p.login_id) AS name,
  p.is_active,
  p.created_at,
  p.updated_at
FROM public.profiles p
WHERE p.user_type = 'pm_pd' AND p.is_active = true;

GRANT SELECT ON public.hdec_pic_master TO authenticated;
GRANT SELECT ON public.hdec_eng_master TO authenticated;