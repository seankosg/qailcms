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
      -- 겸직: PIC · ENG 두 명부에 모두 등재된 인원
      'dual_roster', (
        EXISTS (SELECT 1 FROM public.hdec_eng_name_master e
                 WHERE e.name_norm = r.name_norm AND e.merged_into_id IS NULL)
        AND EXISTS (SELECT 1 FROM public.hdec_pic_name_master q
                     WHERE q.name_norm = r.name_norm AND q.merged_into_id IS NULL)
      ),
      -- LIMIT 1 대신 서열 최고 등급(rcl_highest_role) — 판정과 표시를 일치시킨다.
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
      'team', p.team,
      'team_suggest', NULL,
      'is_active', p.is_active,
      'has_account', true,
      'dual_roster', false,
      'role', public.rcl_highest_role(p.id)::text,
      'tm',0,'abd',0,'sm',0,'spl',0,'wrt',0,'total',0,
      'first_seen', p.created_at, 'last_seen', NULL
    ) AS j, 0::bigint AS total, true AS has_account, p.name AS nm
    FROM public.profiles p
    WHERE _include_orphans
      AND NOT EXISTS (SELECT 1 FROM public.hdec_eng_name_master m WHERE m.name_norm = p.name_norm)
      AND NOT EXISTS (SELECT 1 FROM public.hdec_pic_name_master m WHERE m.name_norm = p.name_norm)
      -- 명부 밖 계정은 자기 구분 탭에서만 노출. 구분 미지정은 양쪽 노출.
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