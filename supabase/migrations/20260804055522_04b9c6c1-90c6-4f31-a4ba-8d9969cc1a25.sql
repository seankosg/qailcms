
-- 공통: 관리자 확인
CREATE OR REPLACE FUNCTION public.hdec_assert_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]) THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hdec_master_table(_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT CASE WHEN _kind = 'eng' THEN 'hdec_eng_name_master'
                  WHEN _kind = 'pic' THEN 'hdec_pic_name_master' END $$;

-- 모듈별 사용 건수 (norm 단위)
CREATE OR REPLACE FUNCTION public.hdec_name_usage(_kind text)
RETURNS TABLE(norm text, module text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _kind NOT IN ('eng','pic') THEN RAISE EXCEPTION 'invalid kind %', _kind; END IF;
  IF _kind = 'eng' THEN
    RETURN QUERY
      SELECT public.hdec_name_norm(t.hdec_eng_name), 'tm', count(*) FROM public.task_management_raw t
        WHERE COALESCE(btrim(t.hdec_eng_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(a.hdec_eng_name), 'abd', count(*) FROM public.abd_items_raw a
        WHERE COALESCE(btrim(a.hdec_eng_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(d.hdec_eng_name), 'sm', count(*) FROM public.defect_items_raw d
        WHERE COALESCE(btrim(d.hdec_eng_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(s.eng), 'spl', count(*) FROM public.spl_items s
        WHERE COALESCE(btrim(s.eng),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(w.eng), 'wrt', count(*) FROM public.wrt_items w
        WHERE COALESCE(btrim(w.eng),'') <> '' GROUP BY 1;
  ELSE
    RETURN QUERY
      SELECT public.hdec_name_norm(t.hdec_pic_name), 'tm', count(*) FROM public.task_management_raw t
        WHERE COALESCE(btrim(t.hdec_pic_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(a.hdec_pic_name), 'abd', count(*) FROM public.abd_items_raw a
        WHERE COALESCE(btrim(a.hdec_pic_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(d.hdec_pic_name), 'sm', count(*) FROM public.defect_items_raw d
        WHERE COALESCE(btrim(d.hdec_pic_name),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(s.pic), 'spl', count(*) FROM public.spl_items s
        WHERE COALESCE(btrim(s.pic),'') <> '' GROUP BY 1
      UNION ALL SELECT public.hdec_name_norm(w.pic), 'wrt', count(*) FROM public.wrt_items w
        WHERE COALESCE(btrim(w.pic),'') <> '' GROUP BY 1;
  END IF;
END $$;

-- 명부 목록 (전건, 숨김 필터 없음)
CREATE OR REPLACE FUNCTION public.hdec_roster_list(_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  rows AS (
    SELECT m.*,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='tm'), 0) AS cnt_tm,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='abd'), 0) AS cnt_abd,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='sm'), 0) AS cnt_sm,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='spl'), 0) AS cnt_spl,
      COALESCE((SELECT sum(cnt) FROM agg a WHERE a.id = m.id AND a.module='wrt'), 0) AS cnt_wrt,
      (SELECT p.name FROM public.profiles p WHERE p.id = m.linked_user_id) AS linked_user_name,
      (SELECT m2.name FROM master m2 WHERE m2.id = m.merged_into_id) AS merged_into_name
      FROM master m
  )
  SELECT jsonb_build_object(
    'kind', _kind,
    'rows', COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object('source','master') ORDER BY r.name), '[]'::jsonb)
  ) INTO v FROM rows r;

  -- profiles 출신(뷰에 섞여 있던) 행: 읽기 전용으로 별도 제공
  SELECT v || jsonb_build_object('profile_rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', btrim(p.name), 'name_norm', p.name_norm, 'source', 'profile',
      'login_id', p.login_id, 'user_type', p.user_type, 'team', p.team, 'is_active', p.is_active
    ) ORDER BY p.name)
    FROM public.profiles p
    WHERE p.user_type IN ('hdec','hdec_pic','hdec_eng','pm_pd') AND p.is_active = true
  ), '[]'::jsonb)) INTO v;

  RETURN v;
END $$;

-- 대표 이름 변경 영향 건수 미리보기
CREATE OR REPLACE FUNCTION public.hdec_roster_rename_preview(_kind text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_norms text[]; v jsonb;
BEGIN
  PERFORM public.hdec_assert_admin();
  IF _kind = 'eng' THEN
    SELECT ARRAY[m.name_norm] || (SELECT COALESCE(array_agg(public.hdec_name_norm(x)),'{}'::text[]) FROM unnest(COALESCE(m.name_variants,'{}'::text[])) x)
      INTO v_norms FROM public.hdec_eng_name_master m WHERE m.id = _id;
  ELSE
    SELECT ARRAY[m.name_norm] || (SELECT COALESCE(array_agg(public.hdec_name_norm(x)),'{}'::text[]) FROM unnest(COALESCE(m.name_variants,'{}'::text[])) x)
      INTO v_norms FROM public.hdec_pic_name_master m WHERE m.id = _id;
  END IF;
  IF v_norms IS NULL THEN RAISE EXCEPTION '명부 행을 찾을 수 없습니다.'; END IF;

  SELECT jsonb_object_agg(u.module, u.c) INTO v FROM (
    SELECT module, sum(cnt) c FROM public.hdec_name_usage(_kind) WHERE norm = ANY(v_norms) GROUP BY module
  ) u;
  RETURN jsonb_build_object('by_module', COALESCE(v, '{}'::jsonb),
    'total', COALESCE((SELECT sum(cnt) FROM public.hdec_name_usage(_kind) WHERE norm = ANY(v_norms)), 0));
END $$;

-- 명부 name 변경 시 모듈 전파 (N5)
CREATE OR REPLACE FUNCTION public.hdec_master_propagate_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := CASE WHEN TG_TABLE_NAME = 'hdec_eng_name_master' THEN 'eng' ELSE 'pic' END;
  v_norms text[]; v_new text; n int;
BEGIN
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NEW; END IF;
  v_new := btrim(NEW.name);
  v_norms := ARRAY[OLD.name_norm] || (SELECT COALESCE(array_agg(public.hdec_name_norm(x)),'{}'::text[]) FROM unnest(COALESCE(NEW.name_variants,'{}'::text[])) x);

  IF v_kind = 'eng' THEN
    WITH u AS (UPDATE public.task_management_raw SET hdec_eng_name = v_new WHERE public.hdec_name_norm(hdec_eng_name) = ANY(v_norms) AND hdec_eng_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'task_management_raw','hdec_eng_name',0,n); END IF;
    WITH u AS (UPDATE public.abd_items_raw SET hdec_eng_name = v_new WHERE public.hdec_name_norm(hdec_eng_name) = ANY(v_norms) AND hdec_eng_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'abd_items_raw','hdec_eng_name',0,n); END IF;
    WITH u AS (UPDATE public.defect_items_raw SET hdec_eng_name = v_new WHERE public.hdec_name_norm(hdec_eng_name) = ANY(v_norms) AND hdec_eng_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'defect_items_raw','hdec_eng_name',0,n); END IF;
    WITH u AS (UPDATE public.spl_items SET eng = v_new WHERE public.hdec_name_norm(eng) = ANY(v_norms) AND eng IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'spl_items','eng',0,n); END IF;
    WITH u AS (UPDATE public.wrt_items SET eng = v_new WHERE public.hdec_name_norm(eng) = ANY(v_norms) AND eng IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'wrt_items','eng',0,n); END IF;
  ELSE
    WITH u AS (UPDATE public.task_management_raw SET hdec_pic_name = v_new WHERE public.hdec_name_norm(hdec_pic_name) = ANY(v_norms) AND hdec_pic_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'task_management_raw','hdec_pic_name',0,n); END IF;
    WITH u AS (UPDATE public.abd_items_raw SET hdec_pic_name = v_new WHERE public.hdec_name_norm(hdec_pic_name) = ANY(v_norms) AND hdec_pic_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'abd_items_raw','hdec_pic_name',0,n); END IF;
    WITH u AS (UPDATE public.defect_items_raw SET hdec_pic_name = v_new WHERE public.hdec_name_norm(hdec_pic_name) = ANY(v_norms) AND hdec_pic_name IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'defect_items_raw','hdec_pic_name',0,n); END IF;
    WITH u AS (UPDATE public.spl_items SET pic = v_new WHERE public.hdec_name_norm(pic) = ANY(v_norms) AND pic IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'spl_items','pic',0,n); END IF;
    WITH u AS (UPDATE public.wrt_items SET pic = v_new WHERE public.hdec_name_norm(pic) = ANY(v_norms) AND pic IS DISTINCT FROM v_new RETURNING 1)
      SELECT count(*) INTO n FROM u;
    IF n > 0 THEN INSERT INTO public.hdec_name_propagation_log(source,ref_id,from_name,to_name,target_table,target_column,owned_rows,unowned_rows) VALUES ('master',NEW.id,OLD.name,v_new,'wrt_items','pic',0,n); END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hdec_eng_master_propagate ON public.hdec_eng_name_master;
CREATE TRIGGER trg_hdec_eng_master_propagate AFTER UPDATE OF name ON public.hdec_eng_name_master
FOR EACH ROW EXECUTE FUNCTION public.hdec_master_propagate_name();
DROP TRIGGER IF EXISTS trg_hdec_pic_master_propagate ON public.hdec_pic_name_master;
CREATE TRIGGER trg_hdec_pic_master_propagate AFTER UPDATE OF name ON public.hdec_pic_name_master
FOR EACH ROW EXECUTE FUNCTION public.hdec_master_propagate_name();

-- 명부 행 동작
CREATE OR REPLACE FUNCTION public.hdec_roster_update(
  _kind text, _id uuid,
  _name text DEFAULT NULL, _variants text[] DEFAULT NULL, _verified boolean DEFAULT NULL,
  _linked_user_id uuid DEFAULT NULL, _clear_link boolean DEFAULT false, _note text DEFAULT NULL,
  _is_active boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.hdec_assert_admin();
  IF _kind = 'eng' THEN
    UPDATE public.hdec_eng_name_master SET
      name = COALESCE(NULLIF(btrim(COALESCE(_name,'')),''), name),
      name_variants = COALESCE(_variants, name_variants),
      verified = COALESCE(_verified, verified),
      linked_user_id = CASE WHEN _clear_link THEN NULL ELSE COALESCE(_linked_user_id, linked_user_id) END,
      note = COALESCE(_note, note),
      is_active = COALESCE(_is_active, is_active),
      updated_at = now()
    WHERE id = _id;
  ELSIF _kind = 'pic' THEN
    UPDATE public.hdec_pic_name_master SET
      name = COALESCE(NULLIF(btrim(COALESCE(_name,'')),''), name),
      name_variants = COALESCE(_variants, name_variants),
      verified = COALESCE(_verified, verified),
      linked_user_id = CASE WHEN _clear_link THEN NULL ELSE COALESCE(_linked_user_id, linked_user_id) END,
      note = COALESCE(_note, note),
      is_active = COALESCE(_is_active, is_active),
      updated_at = now()
    WHERE id = _id;
  ELSE RAISE EXCEPTION 'invalid kind %', _kind;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 병합: 삭제하지 않고 merged_into_id 로 표시하고 변형을 대상 행으로 옮긴다.
CREATE OR REPLACE FUNCTION public.hdec_roster_merge(_kind text, _src_id uuid, _dst_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_src_name text; v_src_variants text[];
BEGIN
  PERFORM public.hdec_assert_admin();
  IF _src_id = _dst_id THEN RAISE EXCEPTION '같은 행끼리는 병합할 수 없습니다.'; END IF;
  IF _kind = 'eng' THEN
    SELECT name, COALESCE(name_variants,'{}') INTO v_src_name, v_src_variants FROM public.hdec_eng_name_master WHERE id = _src_id;
    IF v_src_name IS NULL THEN RAISE EXCEPTION '원본 행을 찾을 수 없습니다.'; END IF;
    UPDATE public.hdec_eng_name_master
       SET name_variants = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(name_variants,'{}') || v_src_variants || ARRAY[v_src_name]) x WHERE public.hdec_name_norm(x) <> name_norm),
           updated_at = now()
     WHERE id = _dst_id;
    UPDATE public.hdec_eng_name_master SET merged_into_id = _dst_id, is_active = false, updated_at = now() WHERE id = _src_id;
  ELSIF _kind = 'pic' THEN
    SELECT name, COALESCE(name_variants,'{}') INTO v_src_name, v_src_variants FROM public.hdec_pic_name_master WHERE id = _src_id;
    IF v_src_name IS NULL THEN RAISE EXCEPTION '원본 행을 찾을 수 없습니다.'; END IF;
    UPDATE public.hdec_pic_name_master
       SET name_variants = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(name_variants,'{}') || v_src_variants || ARRAY[v_src_name]) x WHERE public.hdec_name_norm(x) <> name_norm),
           updated_at = now()
     WHERE id = _dst_id;
    UPDATE public.hdec_pic_name_master SET merged_into_id = _dst_id, is_active = false, updated_at = now() WHERE id = _src_id;
  ELSE RAISE EXCEPTION 'invalid kind %', _kind;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 자동 등재 (임포트 커밋 시 호출)
CREATE OR REPLACE FUNCTION public.hdec_registry_upsert(_kind text, _names text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_inserted int := 0; v_touched int := 0; nm text; v_norm text; v_hit uuid;
BEGIN
  IF _kind NOT IN ('eng','pic') THEN RAISE EXCEPTION 'invalid kind %', _kind; END IF;
  FOREACH nm IN ARRAY COALESCE(_names, '{}'::text[]) LOOP
    CONTINUE WHEN nm IS NULL OR btrim(nm) = '';
    v_norm := public.hdec_name_norm(nm);
    IF _kind = 'eng' THEN
      SELECT id INTO v_hit FROM public.hdec_eng_name_master
       WHERE name_norm = v_norm
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(name_variants,'{}')) x WHERE public.hdec_name_norm(x) = v_norm)
       LIMIT 1;
      IF v_hit IS NULL THEN
        INSERT INTO public.hdec_eng_name_master(name, name_norm, is_active, last_seen_at)
        VALUES (btrim(nm), v_norm, true, now()) ON CONFLICT (name_norm) DO NOTHING;
        v_inserted := v_inserted + 1;
      ELSE
        UPDATE public.hdec_eng_name_master SET last_seen_at = now() WHERE id = v_hit;
        v_touched := v_touched + 1;
      END IF;
    ELSE
      SELECT id INTO v_hit FROM public.hdec_pic_name_master
       WHERE name_norm = v_norm
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(name_variants,'{}')) x WHERE public.hdec_name_norm(x) = v_norm)
       LIMIT 1;
      IF v_hit IS NULL THEN
        INSERT INTO public.hdec_pic_name_master(name, name_norm, is_active, last_seen_at)
        VALUES (btrim(nm), v_norm, true, now()) ON CONFLICT (name_norm) DO NOTHING;
        v_inserted := v_inserted + 1;
      ELSE
        UPDATE public.hdec_pic_name_master SET last_seen_at = now() WHERE id = v_hit;
        v_touched := v_touched + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', v_inserted, 'touched', v_touched);
END $$;

-- 백필: 5개 모듈 distinct 이름을 명부로
CREATE OR REPLACE FUNCTION public.hdec_registry_backfill(_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_names text[];
BEGIN
  PERFORM public.hdec_assert_admin();
  IF _kind = 'eng' THEN
    SELECT array_agg(DISTINCT n) INTO v_names FROM (
      SELECT btrim(hdec_eng_name) n FROM public.task_management_raw WHERE COALESCE(btrim(hdec_eng_name),'')<>''
      UNION SELECT btrim(hdec_eng_name) FROM public.abd_items_raw WHERE COALESCE(btrim(hdec_eng_name),'')<>''
      UNION SELECT btrim(hdec_eng_name) FROM public.defect_items_raw WHERE COALESCE(btrim(hdec_eng_name),'')<>''
      UNION SELECT btrim(eng) FROM public.spl_items WHERE COALESCE(btrim(eng),'')<>''
      UNION SELECT btrim(eng) FROM public.wrt_items WHERE COALESCE(btrim(eng),'')<>''
    ) s;
  ELSE
    SELECT array_agg(DISTINCT n) INTO v_names FROM (
      SELECT btrim(hdec_pic_name) n FROM public.task_management_raw WHERE COALESCE(btrim(hdec_pic_name),'')<>''
      UNION SELECT btrim(hdec_pic_name) FROM public.abd_items_raw WHERE COALESCE(btrim(hdec_pic_name),'')<>''
      UNION SELECT btrim(hdec_pic_name) FROM public.defect_items_raw WHERE COALESCE(btrim(hdec_pic_name),'')<>''
      UNION SELECT btrim(pic) FROM public.spl_items WHERE COALESCE(btrim(pic),'')<>''
      UNION SELECT btrim(pic) FROM public.wrt_items WHERE COALESCE(btrim(pic),'')<>''
    ) s;
  END IF;
  RETURN public.hdec_registry_upsert(_kind, COALESCE(v_names, '{}'::text[]));
END $$;

-- 임포트 별칭 치환용 조회 (변형 → 대표)
CREATE OR REPLACE FUNCTION public.hdec_canonical_map(_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  IF _kind NOT IN ('eng','pic') THEN RAISE EXCEPTION 'invalid kind %', _kind; END IF;
  IF _kind = 'eng' THEN
    SELECT jsonb_object_agg(k, v) INTO v FROM (
      SELECT public.hdec_name_norm(x) k, COALESCE(t.name, m.name) v
        FROM public.hdec_eng_name_master m
        LEFT JOIN public.hdec_eng_name_master t ON t.id = m.merged_into_id,
        LATERAL unnest(ARRAY[m.name] || COALESCE(m.name_variants,'{}')) x
    ) s;
  ELSE
    SELECT jsonb_object_agg(k, v) INTO v FROM (
      SELECT public.hdec_name_norm(x) k, COALESCE(t.name, m.name) v
        FROM public.hdec_pic_name_master m
        LEFT JOIN public.hdec_pic_name_master t ON t.id = m.merged_into_id,
        LATERAL unnest(ARRAY[m.name] || COALESCE(m.name_variants,'{}')) x
    ) s;
  END IF;
  RETURN COALESCE(v, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.hdec_roster_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_roster_rename_preview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_roster_update(text, uuid, text, text[], boolean, uuid, boolean, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_roster_merge(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_registry_upsert(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_registry_backfill(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hdec_canonical_map(text) TO authenticated;
