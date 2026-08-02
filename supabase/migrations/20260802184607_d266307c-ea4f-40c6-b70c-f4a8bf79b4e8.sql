CREATE OR REPLACE FUNCTION public.aac_tm_autofill_actuals_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (current_timestamp AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  IF NEW.level = 'main' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.progress_observed_at IS NULL
       AND public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
       AND public.tm_norm_progress(NEW.actual_progress) > 0 THEN
      NEW.progress_observed_at := v_today;
    END IF;
  ELSE
    IF NEW.progress_observed_at IS NOT DISTINCT FROM OLD.progress_observed_at
       AND NEW.actual_progress IS DISTINCT FROM OLD.actual_progress THEN
      NEW.progress_observed_at := v_today;
    END IF;
  END IF;

  -- (e) 하향 시 완료 취소
  IF TG_OP = 'UPDATE'
     AND public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(OLD.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(NEW.actual_progress) < public.tm_norm_progress(OLD.actual_progress)
     AND NEW.actual_finish IS NOT DISTINCT FROM OLD.actual_finish
     AND public.tm_norm_progress(NEW.actual_progress) < 1 THEN
    NEW.actual_finish := NULL;
    NEW.actual_finish_source := NULL;
  END IF;

  -- (c) 완료일이 있으면 완료
  IF NEW.actual_finish IS NOT NULL
     AND (NEW.actual_progress IS NULL OR public.tm_norm_progress(NEW.actual_progress) < 1) THEN
    NEW.actual_progress := 1;
  END IF;

  -- (a) 진도가 있는데 시작일이 없으면 채움 (관측일 우선 — R-6-1)
  IF public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(NEW.actual_progress) > 0
     AND NEW.actual_start IS NULL THEN
    NEW.actual_start := COALESCE(NEW.progress_observed_at, NEW.data_date, v_today);
  END IF;

  -- (b) 완료일만 있고 시작일이 없으면 완료일로 채움
  IF NEW.actual_finish IS NOT NULL AND NEW.actual_start IS NULL THEN
    NEW.actual_start := NEW.actual_finish;
  END IF;

  -- (g) C3 보정
  IF NEW.actual_finish IS NOT NULL
     AND NEW.actual_start IS NOT NULL
     AND NEW.actual_finish < NEW.actual_start THEN
    NEW.actual_start := NEW.actual_finish;
  END IF;

  -- (i) 사람이 직접 넣은 완료일을 'user' 로 승격 (R-6-3)
  IF TG_OP = 'UPDATE'
     AND NEW.actual_finish IS NOT NULL
     AND NEW.actual_finish IS DISTINCT FROM OLD.actual_finish
     AND NEW.actual_finish_source IS NOT DISTINCT FROM OLD.actual_finish_source THEN
    NEW.actual_finish_source := 'user';
  END IF;

  -- (h) C1 보정: 진도율 100% 인데 완료일 없음
  IF public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(NEW.actual_progress) >= 1
     AND NEW.actual_finish IS NULL THEN
    NEW.actual_finish := COALESCE(NEW.progress_observed_at, NEW.data_date, v_today);
    NEW.actual_finish_source := 'auto';
    IF NEW.actual_start IS NOT NULL AND NEW.actual_finish < NEW.actual_start THEN
      NEW.actual_start := NEW.actual_finish;
    END IF;
  END IF;

  -- (R-6-4 정정, 2-1) INSERT 한정: 완료일이 실려 왔는데 출처가 없으면 'user'
  IF TG_OP = 'INSERT' AND NEW.actual_finish IS NOT NULL AND NEW.actual_finish_source IS NULL THEN
    NEW.actual_finish_source := 'user';
  END IF;

  -- (4-1a) 불변식: 완료일이 없으면 출처도 없다
  IF NEW.actual_finish IS NULL THEN
    NEW.actual_finish_source := NULL;
  END IF;

  RETURN NEW;
END;
$function$;