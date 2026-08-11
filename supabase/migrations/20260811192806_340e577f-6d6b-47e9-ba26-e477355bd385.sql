CREATE OR REPLACE FUNCTION public.rcl_bulk_role_apply(_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _rank jsonb := '{"system_administrator":110,"admin":100,"superuser":90,"d_superuser":80,"senior_user":70,"user":50,"super_guest":30,"guest":10}'::jsonb;
  _pv jsonb; _row jsonb; _applied int := 0; _admins int;
BEGIN
  IF NOT public.is_system_admin(_me) THEN
    RAISE EXCEPTION 'System Administrator 전용 기능입니다';
  END IF;
  _pv := public.rcl_bulk_role_preview(_items);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_pv) e
              WHERE e->>'class' IN ('not_found','duplicate','invalid_role')) THEN
    RAISE EXCEPTION '미해결 항목이 있어 실행할 수 없습니다 (못찾음 · 중복 · 잘못된 등급)';
  END IF;

  FOR _row IN SELECT e FROM jsonb_array_elements(_pv) e WHERE e->>'class' = 'change'
  LOOP
    IF (_row->>'user_id')::uuid = _me
       AND (_rank->>(_row->>'role'))::int < (_rank->>(_row->>'current_role'))::int THEN
      RAISE EXCEPTION '본인 계정의 등급은 낮출 수 없습니다 (%)', _row->>'name';
    END IF;
    IF public.has_role((_row->>'user_id')::uuid, 'system_administrator') THEN
      RAISE EXCEPTION '최상위 등급 계정은 이 경로로 변경할 수 없습니다 (%)', _row->>'name';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = (_row->>'user_id')::uuid;
    INSERT INTO public.user_roles(user_id, role)
    VALUES ((_row->>'user_id')::uuid, (_row->>'role')::app_role);
    _applied := _applied + 1;
  END LOOP;

  SELECT count(*) INTO _admins FROM public.user_roles WHERE role IN ('admin','system_administrator');
  IF _admins = 0 THEN
    RAISE EXCEPTION 'Admin 이 0명이 되는 변경은 거부됩니다';
  END IF;

  RETURN jsonb_build_object('applied', _applied, 'admins_after', _admins, 'preview', _pv);
END $$;