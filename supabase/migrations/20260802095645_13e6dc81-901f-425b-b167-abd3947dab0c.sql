-- 임시 진단용 QAQC 테스트 계정 생성 (검증 후 삭제 예정)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', '11111111-2222-3333-4444-555555555555', 'authenticated','authenticated','qaqcdiag@qail.local', crypt('Diag!12345', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}', false, false)
on conflict (id) do update set encrypted_password = excluded.encrypted_password;

insert into public.profiles (id, email, login_id, user_type, team, is_active, must_change_password)
values ('11111111-2222-3333-4444-555555555555','qaqcdiag@qail.local','qaqcdiag','hdec_pic','QAQC', true, false)
on conflict (id) do update set team='QAQC', user_type='hdec_pic', is_active=true, must_change_password=false;

insert into public.user_roles (user_id, role) values ('11111111-2222-3333-4444-555555555555','d_superuser') on conflict do nothing;