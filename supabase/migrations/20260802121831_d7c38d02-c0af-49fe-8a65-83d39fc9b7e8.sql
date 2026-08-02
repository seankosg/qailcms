CREATE OR REPLACE FUNCTION public.tm_expected_finish(actual_start date, actual_finish date, actual_progress numeric, data_date date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  ap numeric := COALESCE(actual_progress, 0);
  elapsed integer; daily numeric; remain numeric;
BEGIN
  IF actual_finish IS NOT NULL THEN RETURN actual_finish; END IF;
  -- ap>=1 분기는 제약 C2 우회 행(임포트 예외)에 대한 안전망.
  --     정상 경로에서는 도달하지 않는다.
  IF ap >= 1 THEN RETURN COALESCE(actual_finish, data_date); END IF;
  IF actual_start IS NULL OR data_date IS NULL OR ap <= 0 THEN RETURN NULL; END IF;
  elapsed := (data_date - actual_start) + 1;
  IF elapsed <= 0 THEN RETURN NULL; END IF;
  daily := ap / elapsed;
  IF daily <= 0 THEN RETURN NULL; END IF;
  remain := (1 - ap) / daily;
  RETURN data_date + CEIL(remain)::integer;
END $function$;

CREATE OR REPLACE FUNCTION public.tm_compute_derived(_plan_start date, _plan_end date, _plan_days integer, _actual_start date, _actual_finish date, _actual_progress numeric, _data_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  as_of         date;
  pd            integer;
  cum_plan      numeric;
  actual        numeric := least(1, greatest(0, coalesce(_actual_progress, 0)));
  gap           numeric;
  judgment      text;
  reason        text;
  delay_d       integer;
  started       boolean;
  th            jsonb;
  caution       numeric;
  worsen        numeric;
  done          boolean;
BEGIN
  th := public.tm_thresholds();
  caution := (th->>'caution_gap_buffer')::numeric;
  worsen  := (th->>'worsen_gap')::numeric;

  as_of := coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);
  started := _actual_start IS NOT NULL OR actual > 0;
  -- 완료 정본: actual_finish 단독 (B-1)
  done := _actual_finish IS NOT NULL;

  IF _plan_days IS NOT NULL AND _plan_days > 0 THEN
    pd := _plan_days;
  ELSIF _plan_start IS NOT NULL AND _plan_end IS NOT NULL THEN
    pd := greatest(1, (_plan_end - _plan_start) + 1);
  ELSE
    pd := NULL;
  END IF;

  IF _plan_start IS NULL OR pd IS NULL THEN
    cum_plan := NULL;
  ELSIF as_of < _plan_start THEN
    cum_plan := 0;
  ELSIF _plan_end IS NOT NULL AND as_of >= _plan_end THEN
    cum_plan := 1;
  ELSE
    cum_plan := ((as_of - _plan_start) + 1)::numeric / pd::numeric;
    IF cum_plan < 0 THEN cum_plan := 0; ELSIF cum_plan > 1 THEN cum_plan := 1; END IF;
  END IF;

  gap := CASE WHEN cum_plan IS NULL THEN NULL ELSE actual - cum_plan END;

  IF done THEN
    IF _plan_end IS NOT NULL AND _actual_finish > _plan_end THEN
      delay_d := _actual_finish - _plan_end;
    ELSE
      delay_d := 0;
    END IF;
  ELSIF _plan_end IS NOT NULL AND as_of > _plan_end THEN
    delay_d := as_of - _plan_end;
  ELSE
    delay_d := 0;
  END IF;

  IF done THEN
    judgment := '완료';
    reason := CASE WHEN delay_d > 0 THEN '지연완료(' || delay_d || 'd)' ELSE '정상완료' END;
  ELSIF NOT started THEN
    IF _plan_start IS NOT NULL AND _plan_start <= as_of THEN
      judgment := '지연';
      reason := 'Start 미착수 (계획일 도과)';
    ELSE
      judgment := '정상';
      reason := 'Start 대기';
    END IF;
  ELSIF gap IS NULL THEN
    judgment := '정상';
    reason := '계획정보 부족';
  ELSIF gap < worsen THEN
    judgment := '악화';
    reason := 'Gap ' || round(gap*100, 1) || '% < ' || round(worsen*100, 1) || '%';
  ELSIF gap < 0 THEN
    judgment := '지연';
    reason := 'Gap ' || round(gap*100, 1) || '%';
  ELSIF gap < caution THEN
    judgment := '주의';
    reason := 'Gap ' || round(gap*100, 1) || '% (버퍼 ' || round(caution*100, 1) || '%)';
  ELSE
    judgment := '정상';
    reason := 'Gap ' || round(gap*100, 1) || '%';
  END IF;

  RETURN jsonb_build_object(
    'as_of',           as_of,
    'cum_plan_pct',    cum_plan,
    'cum_actual_pct',  actual,
    'gap_pct',         gap,
    'auto_judgment',   judgment,
    'delay_days',      delay_d,
    'alarm_reason',    reason
  );
END;
$function$;