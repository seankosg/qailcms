
INSERT INTO public.team_master (code, name, aliases, sort_order, is_active)
SELECT 'SUPP', 'SUPP', ARRAY['지원','SUPPORT','Support']::text[], 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.team_master WHERE lower(code) = 'supp');

DO $$
DECLARE
  r record;
  v_uid uuid;
  v_email text;
  v_role text;
  v_eng text;
  v_kor text;
  v_display text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('slee',   'SEOK LEE_이석',    'Super User',   'ELEC'),
      ('jylee',  'JY LEE_이준용',    'Super User',   'ARCH'),
      ('hykim',  'HY KIM_김홍엽',    'D.Super User', 'ARCH'),
      ('bhpark', 'BH PARK_박복현',   'D.Super User', 'ELEC'),
      ('htahn',  'HT AHN_안형태',    'D.Super User', 'ELEC'),
      ('dhlim',  'DH LIM_임대현',    'D.Super User', 'ELEC'),
      ('chseo',  'CH SEO_서창훈',    'D.Super User', 'ELEC'),
      ('mhshin', 'MH SHIN_신민호',   'Super User',   'ELEC'),
      ('wjshin', 'WJ SHIN_신원재',   'Super User',   'MECH'),
      ('jhcho',  'JH CHO_조준혁',    'Senior User',  'MECH'),
      ('kdpark', 'KD PARK_박기덕',   'D.Super User', 'MECH'),
      ('jhbaek', 'JH BAEK_백주호',   'D.Super User', 'MECH'),
      ('jssung', 'JS SUNG_성종수',   'D.Super User', 'MECH'),
      ('nklee',  'NK LEE_이남길',    'D.Super User', 'MECH'),
      ('mschoi', 'MS CHOI_최민수',   'D.Super User', 'MECH'),
      ('twyoo',  'TW YOO_유태완',    'D.Super User', 'MECH'),
      ('yhhan',  'YH HAN_한영훈',    'D.Super User', 'DESN'),
      ('jhlee',  'JH LEE_이주한',    'D.Super User', 'DESN'),
      ('mcpark', 'MC PARK_박명천',   'D.Super User', 'DESN'),
      ('khjung', 'KH JUNG_정경호',   'D.Super User', 'SUPP'),
      ('dskim',  'DS KIM_김대수',    'D.Super User', 'SUPP'),
      ('bmseo',  'BM SEO_서봉문',    'D.Super User', 'SUPP'),
      ('hwchae', 'HW CHAE_채홍욱',   'Super User',   'PRJC'),
      ('krna',   'KR NA_나경락',     'D.Super User', 'PRJC'),
      ('yksung', 'YK SUNG_성영광',   'D.Super User', 'PRJC'),
      ('yskim',  'YS KIM_김영서',    'D.Super User', 'PRJC'),
      ('sclee',  'SC LEE_이세철',    'D.Super User', 'PRJC')
    ) AS t(login_id, full_name, role_label, team)
  LOOP
    v_email := lower(r.login_id) || '@qail.local';

    IF EXISTS (SELECT 1 FROM public.profiles WHERE login_id = lower(r.login_id)) THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
      CONTINUE;
    END IF;

    v_role := CASE r.role_label
      WHEN 'Super User' THEN 'superuser'
      WHEN 'D.Super User' THEN 'd_superuser'
      WHEN 'Senior User' THEN 'senior_user'
      ELSE 'user'
    END;

    v_eng := split_part(r.full_name, '_', 1);
    v_kor := split_part(r.full_name, '_', 2);
    v_display := r.full_name;

    v_uid := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_email,
      crypt('Qail@2026!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object(
        'login_id', lower(r.login_id),
        'display_name', v_display,
        'name', v_kor,
        'user_type', 'hdec',
        'team', r.team,
        'hdec_pic_name', v_display,
        'hdec_eng_name', v_eng,
        'role', v_role,
        'must_change_password', true
      ),
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );

    UPDATE public.profiles
       SET team = r.team,
           name = v_kor,
           hdec_eng_name = v_eng
     WHERE id = v_uid;
  END LOOP;
END $$;
