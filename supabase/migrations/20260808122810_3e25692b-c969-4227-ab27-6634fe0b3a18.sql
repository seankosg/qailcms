-- Rollback of the 2026-08-08 reverse-inference backfill (20260808115618).
-- Idempotent: safe to re-run; no-op once already rolled back.

UPDATE public.wrt_stage_progress
   SET actual_start = NULL,
       actual_finish = NULL,
       actual_estimated = false
 WHERE actual_estimated IS TRUE;

UPDATE public.spl_stage_progress
   SET actual_start = NULL,
       actual_finish = NULL,
       actual_estimated = false
 WHERE actual_estimated IS TRUE;

DELETE FROM public.wrt_stage_progress
 WHERE plan_start IS NULL
   AND plan_finish IS NULL
   AND actual_start IS NULL
   AND actual_finish IS NULL
   AND flag_value IS NULL
   AND remarks IS NULL
   AND COALESCE(na_flag, false) = false
   AND COALESCE(actual_estimated, false) = false;

DELETE FROM public.spl_stage_progress
 WHERE plan_start IS NULL
   AND plan_finish IS NULL
   AND actual_start IS NULL
   AND actual_finish IS NULL
   AND flag_value IS NULL
   AND remarks IS NULL
   AND COALESCE(na_flag, false) = false
   AND COALESCE(actual_estimated, false) = false;