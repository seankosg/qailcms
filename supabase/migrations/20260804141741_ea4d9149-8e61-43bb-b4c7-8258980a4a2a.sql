-- §3-3: 역할 일괄 지정 — 미리보기 / 실행 (admin 단독, 단일 트랜잭션)
CREATE OR REPLACE FUNCTION public.rcl_bulk_role_preview(_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb; _me uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_me, 'admin') THEN RAISE EXCEPTION 'admin 전용 기능입니다'; END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'line')::int) INTO _out FROM (
    SELECT jsonb_build_object(
      'line', (it->>'line')::int,
      'name', it->>'name',
      'role', it->>'role',
      'user_id', uid,
      'current_role', CASE WHEN uid IS NULL THEN NULL ELSE public.rcl_highest_role(uid)::text END,
      'match_count', mc,
      'class', CASE
        WHEN (it->>'role') IS NULL OR (it->>'role') = '' THEN 'invalid_role'
        WHEN NOT ((it->>'role') = ANY (ARRAY['admin','superuser','d_superuser','senior_user','user','super_guest','guest'])) THEN 'invalid_role'
        WHEN mc = 0 THEN 'not_found'
        WHEN mc > 1 THEN 'duplicate'
        WHEN public.rcl_highest_role(uid)::text = (it->>'role') THEN 'unchanged'
        ELSE 'change' END
    ) AS x
    FROM jsonb_array_elements(_items) it
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS mc FROM public.profiles p
       WHERE p.name_norm = public.hdec_name_norm(it->>'name')
    ) c
    CROSS JOIN LATERAL (SELECT public.resolve_user_by_name(it->>'name') AS uid) r
  ) s;
  RETURN COALESCE(_out, '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.rcl_bulk_role_preview(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.rcl_bulk_role_preview(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rcl_bulk_role_apply(_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _rank jsonb := '{"admin":100,"superuser":90,"d_superuser":80,"senior_user":70,"user":50,"super_guest":30,"guest":10}'::jsonb;
  _pv jsonb; _row jsonb; _applied int := 0; _admins int;
BEGIN
  IF NOT public.has_role(_me, 'admin') THEN RAISE EXCEPTION 'admin 전용 기능입니다'; END IF;
  _pv := public.rcl_bulk_role_preview(_items);

  -- 부분 반영 금지: 못찾음·중복·잘못된 등급이 하나라도 있으면 전체 거부
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_pv) e
              WHERE e->>'class' IN ('not_found','duplicate','invalid_role')) THEN
    RAISE EXCEPTION '미해결 항목이 있어 실행할 수 없습니다 (못찾음 · 중복 · 잘못된 등급)';
  END IF;

  FOR _row IN SELECT e FROM jsonb_array_elements(_pv) e WHERE e->>'class' = 'change'
  LOOP
    -- 본인 하향 거부
    IF (_row->>'user_id')::uuid = _me
       AND (_rank->>(_row->>'role'))::int < (_rank->>(_row->>'current_role'))::int THEN
      RAISE EXCEPTION '본인 계정의 등급은 낮출 수 없습니다 (%)', _row->>'name';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = (_row->>'user_id')::uuid;
    INSERT INTO public.user_roles(user_id, role)
    VALUES ((_row->>'user_id')::uuid, (_row->>'role')::app_role);
    _applied := _applied + 1;
  END LOOP;

  -- admin 0명 방지 (명단에 없는 사람은 손대지 않으므로 마지막에 한 번만 검사)
  SELECT count(*) INTO _admins FROM public.user_roles WHERE role = 'admin';
  IF _admins = 0 THEN
    RAISE EXCEPTION 'Admin 이 0명이 되는 변경은 거부됩니다';
  END IF;

  RETURN jsonb_build_object('applied', _applied, 'admins_after', _admins, 'preview', _pv);
END $$;
REVOKE ALL ON FUNCTION public.rcl_bulk_role_apply(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.rcl_bulk_role_apply(jsonb) TO authenticated;