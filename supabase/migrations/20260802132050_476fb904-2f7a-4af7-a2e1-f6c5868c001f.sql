CREATE OR REPLACE FUNCTION public.aac_tm_autofill_actuals_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (current_timestamp AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  -- (0) Main 과업은 하위 롤업이 정본이므로 제외
  IF NEW.level = 'main' THEN
    RETURN NEW;
  END IF;

  -- progress_observed_at 각인: 명시 지정이 없고 진도율이 변경된 경우
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

  -- (e) 하향 시 완료 취소 (UPDATE 이고 완료일이 이번 문장에서 변경되지 않은 경우에 한함)
  -- (e) 는 NEW.actual_progress 가 NULL 인 경우 발동하지 않는다.
  --     완료 취소는 actual_finish 삭제 경로로만 한다(원칙 0-2).
  IF TG_OP = 'UPDATE'
     AND public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(OLD.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(NEW.actual_progress) < public.tm_norm_progress(OLD.actual_progress)
     AND NEW.actual_finish IS NOT DISTINCT FROM OLD.actual_finish
     AND public.tm_norm_progress(NEW.actual_progress) < 1 THEN
    NEW.actual_finish := NULL;
    NEW.actual_finish_source := NULL;
  END IF;

  -- (c) 완료일이 있으면 완료 (원칙 0-2)
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

  -- (g) C3 보정: 완료일 < 시작일 → 시작일을 완료일에 맞춤
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

  -- (h) C1 보정: 진도율 100% 인데 완료일 없음 → 관측일/기준일/오늘
  IF public.tm_norm_progress(NEW.actual_progress) IS NOT NULL
     AND public.tm_norm_progress(NEW.actual_progress) >= 1
     AND NEW.actual_finish IS NULL THEN
    NEW.actual_finish := COALESCE(NEW.progress_observed_at, NEW.data_date, v_today);
    NEW.actual_finish_source := 'auto';
    IF NEW.actual_start IS NOT NULL AND NEW.actual_finish < NEW.actual_start THEN
      NEW.actual_start := NEW.actual_finish;
    END IF;
  END IF;

  -- (R-6-4) INSERT 경로 보완: 완료일이 실려 왔는데 출처가 없으면 'user'
  IF NEW.actual_finish IS NOT NULL AND NEW.actual_finish_source IS NULL THEN
    NEW.actual_finish_source := 'user';
  END IF;

  RETURN NEW;
END;
$function$;