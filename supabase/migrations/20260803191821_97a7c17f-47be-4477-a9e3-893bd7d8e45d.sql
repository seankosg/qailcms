CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_login_id text;
  v_user_type public.user_type;
  v_subcontractor_name text;
  v_hdec_pic_name text;
  v_must_change boolean;
  v_role public.app_role;
  v_display_name text;
  v_name text;
  v_user_count int;
BEGIN
  v_login_id := COALESCE(NEW.raw_user_meta_data->>'login_id', split_part(NEW.email,'@',1));
  v_user_type := COALESCE((NEW.raw_user_meta_data->>'user_type')::public.user_type, 'hdec');
  v_subcontractor_name := NEW.raw_user_meta_data->>'subcontractor_name';
  v_hdec_pic_name := NEW.raw_user_meta_data->>'hdec_pic_name';
  v_must_change := COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, true);
  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', v_login_id);
  v_name := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'name', v_display_name, v_login_id)), '');
  IF v_name IS NULL THEN
    v_name := v_login_id;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, login_id, user_type, subcontractor_name, hdec_pic_name, must_change_password, name)
  VALUES (NEW.id, NEW.email, v_display_name, v_login_id, v_user_type, v_subcontractor_name, v_hdec_pic_name, v_must_change, v_name);

  SELECT count(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    v_role := 'admin';
  ELSE
    v_role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'guest');
  END IF;

  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, v_role);
  RETURN NEW;
END
$function$;