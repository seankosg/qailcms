-- 1) profiles.name_norm 생성식을 hdec_name_norm(name) 호출로 교체
CREATE TEMP TABLE _pn_before ON COMMIT DROP AS SELECT id, name_norm FROM public.profiles;

ALTER TABLE public.profiles DROP COLUMN name_norm;
ALTER TABLE public.profiles
  ADD COLUMN name_norm text GENERATED ALWAYS AS (public.hdec_name_norm(name)) STORED;
CREATE UNIQUE INDEX profiles_name_norm_key ON public.profiles USING btree (name_norm);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM _pn_before b JOIN public.profiles p ON p.id = b.id
   WHERE p.name_norm IS DISTINCT FROM b.name_norm;
  IF n > 0 THEN
    RAISE EXCEPTION 'name_norm 재생성 불일치 % 행 — 중단', n;
  END IF;
END $$;

-- 2) 인라인 복제 제거: resolve_user_by_name 도 공용 함수 사용
CREATE OR REPLACE FUNCTION public.resolve_user_by_name(_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_norm text; v_id uuid; v_cnt int;
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN RETURN NULL; END IF;
  v_norm := public.hdec_name_norm(_name);
  SELECT count(*) INTO v_cnt FROM public.profiles WHERE name_norm = v_norm;
  IF v_cnt <> 1 THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.profiles WHERE name_norm = v_norm;
  RETURN v_id;
END $function$;

-- 3) 소유권 재계산
CREATE OR REPLACE FUNCTION public.hdec_recalc_owner_for_user(_user_id uuid, _reason text DEFAULT 'recalc')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text; v_name text;
  v_cfg text[][] := ARRAY[
    ARRAY['task_management_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['abd_items_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['defect_items_raw','hdec_pic_name','hdec_eng_name'],
    ARRAY['spl_items','pic','eng'],
    ARRAY['wrt_items','pic','eng']
  ];
  i int; n int; total int := 0;
  v_mods jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.hdec_assert_admin();
  SELECT btrim(name), name_norm INTO v_name, v_norm FROM public.profiles WHERE id = _user_id;
  IF v_norm IS NULL THEN RAISE EXCEPTION 'user % 없음', _user_id; END IF;

  FOR i IN 1 .. array_length(v_cfg, 1) LOOP
    EXECUTE format(
      'WITH u AS (UPDATE public.%I SET owner_user_id = $1
                   WHERE owner_user_id IS DISTINCT FROM $1
                     AND (public.hdec_name_norm(%I) = $2 OR public.hdec_name_norm(%I) = $2)
                 RETURNING 1) SELECT count(*) FROM u',
      v_cfg[i][1], v_cfg[i][2], v_cfg[i][3])
      INTO n USING _user_id, v_norm;
    total := total + n;
    v_mods := v_mods || jsonb_build_object('table', v_cfg[i][1], 'updated', n);
    IF n > 0 THEN
      INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
      VALUES (_reason, _user_id, v_name, v_name, v_cfg[i][1], 'owner_user_id', n, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('user_id', _user_id, 'name', v_name, 'total', total, 'modules', v_mods);
END $function$;

-- 4) 명부 목록에 계정 보유·사용 합계·유사 표기 후보 추가
CREATE OR REPLACE FUNCTION public.hdec_roster_list(_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.hdec_assert_admin();
  IF _kind NOT IN ('eng','pic') THEN RAISE EXCEPTION 'invalid kind %', _kind; END IF;

  WITH usage AS (SELECT * FROM public.hdec_name_usage(_kind)),
  master AS (
    SELECT m.id, m.name, m.name_norm, COALESCE(m.name_variants, '{}'::text[]) AS name_variants,
           m.verified, m.linked_user_id, m.merged_into_id, m.note, m.is_active,
           m.created_at, m.last_seen_at
      FROM (
        SELECT * FROM public.hdec_eng_name_master WHERE _kind = 'eng'
        UNION ALL SELECT * FROM public.hdec_pic_name_master WHERE _kind = 'pic'
      ) m
  ),
  norms AS (
    SELECT id, unnest(ARRAY[name_norm] || (SELECT COALESCE(array_agg(public.hdec_name_norm(x)), '{}'::text[]) FROM unnest(name_variants) x)) AS n
      FROM master
  ),
  agg AS (
    SELECT n.id, u.module, sum(u.cnt) AS cnt
      FROM norms n JOIN usage u ON u.norm = n.n
     GROUP BY n.id, u.module
  ),
  sim AS (
    SELECT a.id,
           jsonb_agg(jsonb_build_object('name', b.name, 'score', round(similarity(a.name_norm, b.name_norm)::numeric, 3))
                     ORDER BY similarity(a.name_norm, b.name_norm) DESC) AS cands
      FROM master a
      JOIN LATERAL (
        SELECT b.name, b.name_norm FROM master b
         WHERE b.id <> a.id AND similarity(a.name_norm, b.name_norm) >= 0.4
         ORDER BY similarity(a.name_norm, b.name_norm) DESC
         LIMIT 3
      ) b ON true
     GROUP BY a.id
  ),
  rows AS (
    SELECT m.*,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='tm'), 0) AS cnt_tm,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='abd'), 0) AS cnt_abd,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='sm'), 0) AS cnt_sm,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='spl'), 0) AS cnt_spl,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='wrt'), 0) AS cnt_wrt,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id), 0) AS cnt_total,
      (SELECT p.id FROM public.profiles p WHERE p.name_norm = m.name_norm) AS account_user_id,
      (SELECT p.login_id FROM public.profiles p WHERE p.name_norm = m.name_norm) AS account_login_id,
      (SELECT p.team FROM public.profiles p WHERE p.name_norm = m.name_norm) AS account_team,
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.name_norm = m.name_norm) AS has_account,
      COALESCE((SELECT s.cands FROM sim s WHERE s.id = m.id), '[]'::jsonb) AS similar_candidates,
      (SELECT p.name FROM public.profiles p WHERE p.id = m.linked_user_id) AS linked_user_name,
      (SELECT m2.name FROM master m2 WHERE m2.id = m.merged_into_id) AS merged_into_name
      FROM master m
  )
  SELECT jsonb_build_object(
    'kind', _kind,
    'rows', COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object('source','master') ORDER BY r.name), '[]'::jsonb)
  ) INTO v FROM rows r;

  SELECT v || jsonb_build_object('profile_rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', btrim(p.name), 'name_norm', p.name_norm, 'source', 'profile',
      'login_id', p.login_id, 'user_type', p.user_type, 'team', p.team, 'is_active', p.is_active
    ) ORDER BY p.name)
    FROM public.profiles p
    WHERE p.user_type IN ('hdec','hdec_pic','hdec_eng','pm_pd') AND p.is_active = true
  ), '[]'::jsonb)) INTO v;

  RETURN v;
END $function$;
