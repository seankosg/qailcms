-- §1: hdec_people_list — 명부 밖 계정(orphan)도 usage_agg 조인으로 실제 등장 건수 표기
CREATE OR REPLACE FUNCTION public.hdec_people_list(_kind text, _include_orphans boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _res jsonb;
BEGIN
  IF _kind NOT IN ('eng','pic') THEN RAISE EXCEPTION 'invalid kind %', _kind; END IF;

  WITH usage AS (
    SELECT norm, module, cnt FROM public.hdec_name_usage(_kind) WHERE norm IS NOT NULL AND norm <> ''
  ),
  usage_agg AS (
    SELECT norm,
           COALESCE(sum(cnt) FILTER (WHERE module='tm'),0)  AS tm,
           COALESCE(sum(cnt) FILTER (WHERE module='abd'),0) AS abd,
           COALESCE(sum(cnt) FILTER (WHERE module='sm'),0)  AS sm,
           COALESCE(sum(cnt) FILTER (WHERE module='spl'),0) AS spl,
           COALESCE(sum(cnt) FILTER (WHERE module='wrt'),0) AS wrt,
           COALESCE(sum(cnt),0) AS total
    FROM usage GROUP BY norm
  ),
  team_raw AS (
    SELECT public.hdec_name_norm(CASE WHEN _kind='eng' THEN t.hdec_eng_name ELSE t.hdec_pic_name END) AS norm,
           NULLIF(btrim(t.team),'') AS team, count(*) AS c
      FROM public.task_management_raw t GROUP BY 1,2
    UNION ALL
    SELECT public.hdec_name_norm(CASE WHEN _kind='eng' THEN a.hdec_eng_name ELSE a.hdec_pic_name END),
           NULLIF(btrim(a.team),''), count(*) FROM public.abd_items_raw a GROUP BY 1,2
    UNION ALL
    SELECT public.hdec_name_norm(CASE WHEN _kind='eng' THEN d.hdec_eng_name ELSE d.hdec_pic_name END),
           NULLIF(btrim(d.team),''), count(*) FROM public.defect_items_raw d GROUP BY 1,2
  ),
  team_mode AS (
    SELECT DISTINCT ON (norm) norm, team
      FROM (SELECT norm, team, sum(c) AS c FROM team_raw
             WHERE norm IS NOT NULL AND norm <> '' AND team IS NOT NULL GROUP BY 1,2) x
     ORDER BY norm, c DESC, team
  ),
  roster AS (
    SELECT m.id, m.name, m.name_norm, m.created_at, m.last_seen_at
      FROM public.hdec_eng_name_master m WHERE _kind='eng' AND m.merged_into_id IS NULL
    UNION ALL
    SELECT m.id, m.name, m.name_norm, m.created_at, m.last_seen_at
      FROM public.hdec_pic_name_master m WHERE _kind='pic' AND m.merged_into_id IS NULL
  ),
  rows_roster AS (
    SELECT jsonb_build_object(
      'source','roster',
      'roster_id', r.id,
      'name', r.name,
      'name_norm', r.name_norm,
      'user_id', p.id,
      'login_id', p.login_id,
      'display_name', p.display_name,
      'user_type', p.user_type,
      'team', COALESCE(p.team, tm.team),
      'team_suggest', tm.team,
      'is_active', p.is_active,
      'has_account', (p.id IS NOT NULL),
      'dual_roster', (
        EXISTS (SELECT 1 FROM public.hdec_eng_name_master e
                 WHERE e.name_norm = r.name_norm AND e.merged_into_id IS NULL)
        AND EXISTS (SELECT 1 FROM public.hdec_pic_name_master q
                     WHERE q.name_norm = r.name_norm AND q.merged_into_id IS NULL)
      ),
      'role', CASE WHEN p.id IS NULL THEN NULL ELSE public.rcl_highest_role(p.id)::text END,
      'tm', COALESCE(u.tm,0), 'abd', COALESCE(u.abd,0), 'sm', COALESCE(u.sm,0),
      'spl', COALESCE(u.spl,0), 'wrt', COALESCE(u.wrt,0), 'total', COALESCE(u.total,0),
      'first_seen', r.created_at, 'last_seen', r.last_seen_at
    ) AS j, COALESCE(u.total,0) AS total, (p.id IS NOT NULL) AS has_account, r.name AS nm
    FROM roster r
    LEFT JOIN public.profiles p ON p.name_norm = r.name_norm
    LEFT JOIN usage_agg u ON u.norm = r.name_norm
    LEFT JOIN team_mode tm ON tm.norm = r.name_norm
  ),
  rows_orphan AS (
    SELECT jsonb_build_object(
      'source','profile',
      'roster_id', NULL,
      'name', p.name,
      'name_norm', p.name_norm,
      'user_id', p.id,
      'login_id', p.login_id,
      'display_name', p.display_name,
      'user_type', p.user_type,
      'team', COALESCE(p.team, tm.team),
      'team_suggest', tm.team,
      'is_active', p.is_active,
      'has_account', true,
      'dual_roster', false,
      'role', public.rcl_highest_role(p.id)::text,
      -- §1(2026-08-04): 0 하드코딩 폐기 → usage_agg 조인. 명부 밖 계정도 실제 등장 건수를 보인다.
      'tm', COALESCE(u.tm,0), 'abd', COALESCE(u.abd,0), 'sm', COALESCE(u.sm,0),
      'spl', COALESCE(u.spl,0), 'wrt', COALESCE(u.wrt,0), 'total', COALESCE(u.total,0),
      'first_seen', p.created_at, 'last_seen', NULL
    ) AS j, COALESCE(u.total,0)::bigint AS total, true AS has_account, p.name AS nm
    FROM public.profiles p
    LEFT JOIN usage_agg u ON u.norm = p.name_norm
    LEFT JOIN team_mode tm ON tm.norm = p.name_norm
    WHERE _include_orphans
      AND NOT EXISTS (SELECT 1 FROM public.hdec_eng_name_master m WHERE m.name_norm = p.name_norm)
      AND NOT EXISTS (SELECT 1 FROM public.hdec_pic_name_master m WHERE m.name_norm = p.name_norm)
      AND (
        p.user_type IS NULL
        OR p.user_type::text NOT IN ('hdec_pic','hdec_eng')
        OR p.user_type::text = (CASE WHEN _kind='pic' THEN 'hdec_pic' ELSE 'hdec_eng' END)
      )
  ),
  all_rows AS (SELECT * FROM rows_roster UNION ALL SELECT * FROM rows_orphan)
  SELECT jsonb_agg(j ORDER BY has_account ASC, total DESC, nm ASC) INTO _res FROM all_rows;

  RETURN COALESCE(_res, '[]'::jsonb);
END $function$;

-- §4-1: TM 임포트 로그에 파서 경고 보관 컬럼
ALTER TABLE public.task_management_import_logs ADD COLUMN IF NOT EXISTS warnings jsonb;

-- §3-2: 모듈 주관팀 변경 이력
CREATE TABLE IF NOT EXISTS public.rcl_module_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  old_team text,
  new_team text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rcl_module_config_audit TO authenticated;
GRANT ALL ON public.rcl_module_config_audit TO service_role;
ALTER TABLE public.rcl_module_config_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read module audit" ON public.rcl_module_config_audit;
CREATE POLICY "admins read module audit" ON public.rcl_module_config_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 팀별 계정 수 (주관팀 변경 확인창용)
CREATE OR REPLACE FUNCTION public.rcl_team_user_counts()
RETURNS TABLE(team text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(p.team),''),'(없음)') AS team, count(*)::bigint
  FROM public.profiles p GROUP BY 1 ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.rcl_team_user_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.rcl_team_user_counts() TO authenticated;

-- 주관팀 변경 (admin 단독) — owning_team 하나만. 나머지 컬럼은 불변.
CREATE OR REPLACE FUNCTION public.rcl_set_module_owning_team(_module text, _team text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text; _new text; _me uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_me, 'admin') THEN
    RAISE EXCEPTION 'admin 전용 기능입니다';
  END IF;
  _new := NULLIF(btrim(COALESCE(_team,'')), '');
  IF _new IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.team_master t WHERE t.name = _new) THEN
    RAISE EXCEPTION '팀 마스터에 없는 팀입니다: %', _new;
  END IF;
  SELECT owning_team INTO _old FROM public.rcl_module_config WHERE module = _module;
  IF NOT FOUND THEN RAISE EXCEPTION '모듈을 찾을 수 없습니다: %', _module; END IF;
  UPDATE public.rcl_module_config SET owning_team = _new, updated_at = now() WHERE module = _module;
  INSERT INTO public.rcl_module_config_audit(module, old_team, new_team, changed_by, changed_by_name)
  VALUES (_module, _old, _new, _me, (SELECT name FROM public.profiles WHERE id = _me));
  RETURN jsonb_build_object('module', _module, 'old_team', _old, 'new_team', _new);
END $$;
REVOKE ALL ON FUNCTION public.rcl_set_module_owning_team(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rcl_set_module_owning_team(text, text) TO authenticated;