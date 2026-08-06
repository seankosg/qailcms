CREATE OR REPLACE FUNCTION public.plot_module_team_last_date()
RETURNS TABLE(plot text, label text, last_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- ABD: 라운드별 DAR 계획일 중 최댓값의 MAX
  SELECT a.plot::text,
         'ABD-' || a.team::text,
         MAX(GREATEST(
           COALESCE(a.r1_dar_plan, '-infinity'::date),
           COALESCE(a.r2_dar_plan, '-infinity'::date),
           COALESCE(a.r3_dar_plan, '-infinity'::date)
         )) FILTER (WHERE COALESCE(a.r1_dar_plan, a.r2_dar_plan, a.r3_dar_plan) IS NOT NULL)
  FROM public.abd_items_raw a
  WHERE a.is_active AND a.plot IS NOT NULL AND a.team IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT i.plot::text, 'SPL-' || i.team::text, MAX(p.plan_finish)
  FROM public.spl_items i
  JOIN public.spl_stage_progress p ON p.item_id = i.id
  WHERE i.is_active AND i.plot IS NOT NULL AND i.team IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT i.plot::text, 'WRT-' || i.team::text, MAX(p.plan_finish)
  FROM public.wrt_items i
  JOIN public.wrt_stage_progress p ON p.item_id = i.id
  WHERE i.is_active AND i.plot IS NOT NULL AND i.team IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  -- SM: plot 컬럼 없음 → 미지정(ALL)
  SELECT 'ALL'::text, 'SM-' || d.team::text, MAX(d.planned_closure_date)
  FROM public.defect_items_raw d
  WHERE d.is_active AND d.team IS NOT NULL
  GROUP BY 1, 2
$$;

REVOKE ALL ON FUNCTION public.plot_module_team_last_date() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plot_module_team_last_date() TO authenticated;
GRANT EXECUTE ON FUNCTION public.plot_module_team_last_date() TO service_role;