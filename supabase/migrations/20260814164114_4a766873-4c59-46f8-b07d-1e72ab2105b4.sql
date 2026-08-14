CREATE OR REPLACE FUNCTION public.thread_user_options()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'team', coalesce(p.team,'미지정'))
                            ORDER BY coalesce(p.team,'미지정'), p.name), '[]'::jsonb)
    INTO v
  FROM public.profiles p
  WHERE coalesce(p.is_active,true) AND coalesce(btrim(p.name),'') <> '';
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.thread_user_options() TO authenticated;