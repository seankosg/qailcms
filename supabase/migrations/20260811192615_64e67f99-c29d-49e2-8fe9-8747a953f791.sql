DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.profiles WHERE login_id = 'admin';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'login_id=admin 계정을 찾을 수 없습니다 (이미 전환되었을 수 있음)';
  END IF;

  UPDATE auth.users
     SET email = 'sadmin@qail.local',
         encrypted_password = extensions.crypt('Qail@2026!', extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = v_id;

  UPDATE public.profiles
     SET login_id = 'sadmin',
         name = 'System Administrator',
         must_change_password = true
   WHERE id = v_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_id, 'system_administrator')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;