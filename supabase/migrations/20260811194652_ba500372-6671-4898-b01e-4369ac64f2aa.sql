DO $$
DECLARE
  _user_id uuid := '32a43945-ef80-4b2d-b48e-742c5a7af126'::uuid;
  _email text := 'sadmin@qail.local';
BEGIN
  UPDATE public.profiles
     SET email = _email
   WHERE id = _user_id
     AND email IS DISTINCT FROM _email;

  UPDATE auth.identities
     SET identity_data = jsonb_set(
       COALESCE(identity_data, '{}'::jsonb),
       '{email}',
       to_jsonb(_email),
       true
     )
   WHERE user_id = _user_id
     AND provider = 'email'
     AND identity_data->>'email' IS DISTINCT FROM _email;

  UPDATE auth.users
     SET email_confirmed_at = now()
   WHERE id = _user_id
     AND email_confirmed_at IS NULL;
END
$$;