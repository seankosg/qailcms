
-- 1) Cache table
CREATE TABLE IF NOT EXISTS public.task_progress_chart_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline text NOT NULL,
  task_no text NOT NULL,
  plan_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  actual_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  x_start date,
  x_end date,
  last_plan_progress numeric,
  last_actual_progress numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discipline, task_no)
);

GRANT SELECT ON public.task_progress_chart_cache TO authenticated;
GRANT ALL ON public.task_progress_chart_cache TO service_role;

ALTER TABLE public.task_progress_chart_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_progress_chart_cache read for authenticated"
  ON public.task_progress_chart_cache FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS task_progress_chart_cache_disc_idx
  ON public.task_progress_chart_cache (discipline);

-- 2) Recalc function: compute plan curve (24 points, plan_start..plan_end)
--    and actual curve (from status_history changes with field='actual_progress',
--    fallback to actual_start->0 and data_date->actual_progress).
CREATE OR REPLACE FUNCTION public.recalc_task_progress_charts(_discipline text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n int := 0;
  npts int := 24;
  i int;
  ps date;
  pe date;
  pdays numeric;
  x_s date;
  x_e date;
  plan_arr jsonb;
  actual_arr jsonb;
  last_plan numeric;
  last_actual numeric;
  d date;
  v numeric;
  hist_pts jsonb;
  hist_count int;
BEGIN
  FOR r IN
    SELECT id, discipline, task_no, plan_start, plan_end, plan_days,
           actual_start, actual_finish, actual_progress, data_date
    FROM public.task_management_raw
    WHERE (_discipline IS NULL OR discipline = _discipline)
      AND task_no IS NOT NULL
  LOOP
    ps := r.plan_start;
    pe := r.plan_end;
    IF ps IS NULL OR pe IS NULL OR pe <= ps THEN
      -- No usable plan window; store empty arrays but keep row for consistency
      plan_arr := '[]'::jsonb;
      last_plan := NULL;
      x_s := COALESCE(r.actual_start, r.data_date);
      x_e := COALESCE(r.data_date, r.actual_finish);
    ELSE
      IF r.plan_days IS NOT NULL AND r.plan_days > 0 THEN
        pdays := r.plan_days;
      ELSE
        pdays := GREATEST(1, (pe - ps));
      END IF;

      plan_arr := '[]'::jsonb;
      FOR i IN 0..(npts - 1) LOOP
        d := ps + ((pe - ps) * i / (npts - 1))::int;
        v := LEAST(1.0, GREATEST(0.0, ((d - ps)::numeric) / pdays));
        plan_arr := plan_arr || jsonb_build_object('d', to_char(d, 'YYYY-MM-DD'), 'v', round(v, 4));
      END LOOP;
      last_plan := 1.0;

      x_s := LEAST(ps, COALESCE(r.actual_start, ps));
      x_e := GREATEST(pe, COALESCE(r.data_date, pe));
    END IF;

    -- Build actual points from status_history changes
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'd', to_char((h.changed_at AT TIME ZONE 'Asia/Qatar')::date, 'YYYY-MM-DD'),
               'v', round(LEAST(1.0, GREATEST(0.0, COALESCE(NULLIF(h.new_value,''),'0')::numeric)), 4)
             )
             ORDER BY h.changed_at
           ), '[]'::jsonb),
           COUNT(*)
      INTO hist_pts, hist_count
      FROM public.task_management_status_history h
     WHERE h.discipline = r.discipline
       AND h.task_no = r.task_no
       AND h.field = 'actual_progress'
       AND h.new_value IS NOT NULL;

    IF hist_count IS NULL OR hist_count < 2 THEN
      -- Fallback: (actual_start, 0) → (data_date, actual_progress)
      actual_arr := '[]'::jsonb;
      IF r.actual_start IS NOT NULL THEN
        actual_arr := actual_arr || jsonb_build_object('d', to_char(r.actual_start,'YYYY-MM-DD'), 'v', 0);
      END IF;
      IF r.data_date IS NOT NULL AND r.actual_progress IS NOT NULL THEN
        actual_arr := actual_arr || jsonb_build_object(
          'd', to_char(r.data_date,'YYYY-MM-DD'),
          'v', round(LEAST(1.0, GREATEST(0.0, r.actual_progress)), 4)
        );
      END IF;
    ELSE
      actual_arr := hist_pts;
    END IF;

    last_actual := r.actual_progress;

    INSERT INTO public.task_progress_chart_cache
      (discipline, task_no, plan_points, actual_points, x_start, x_end,
       last_plan_progress, last_actual_progress, updated_at)
    VALUES
      (r.discipline, r.task_no, plan_arr, actual_arr, x_s, x_e,
       last_plan, last_actual, now())
    ON CONFLICT (discipline, task_no) DO UPDATE
      SET plan_points = EXCLUDED.plan_points,
          actual_points = EXCLUDED.actual_points,
          x_start = EXCLUDED.x_start,
          x_end = EXCLUDED.x_end,
          last_plan_progress = EXCLUDED.last_plan_progress,
          last_actual_progress = EXCLUDED.last_actual_progress,
          updated_at = now();

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_task_progress_charts(text) TO authenticated, service_role;

-- 3) Schedule daily recompute at 02:00 UTC = 05:00 Doha
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('daily-task-progress-recalc')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-task-progress-recalc');
    PERFORM cron.schedule(
      'daily-task-progress-recalc',
      '0 2 * * *',
      $cron$SELECT public.recalc_task_progress_charts(NULL);$cron$
    );
  END IF;
END $$;
