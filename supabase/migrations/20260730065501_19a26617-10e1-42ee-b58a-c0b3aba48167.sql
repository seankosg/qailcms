
-- B-3. 임계값 단일 소스: tm_alarm_settings 확장 (신규 테이블 생성 없음)
ALTER TABLE public.tm_alarm_settings ADD COLUMN IF NOT EXISTS value_num numeric;

INSERT INTO public.tm_alarm_settings(key, value_num)
SELECT 'caution_gap_buffer', COALESCE((SELECT caution_gap_buffer FROM public.task_management_settings WHERE id='default'), 0.05)
WHERE NOT EXISTS (SELECT 1 FROM public.tm_alarm_settings WHERE key='caution_gap_buffer');

INSERT INTO public.tm_alarm_settings(key, value_num)
SELECT 'worsen_gap', COALESCE((SELECT worsen_gap FROM public.task_management_settings WHERE id='default'), -0.15)
WHERE NOT EXISTS (SELECT 1 FROM public.tm_alarm_settings WHERE key='worsen_gap');

-- 단일 소스 게터
CREATE OR REPLACE FUNCTION public.tm_thresholds()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- TM 판정/색상 강조 임계값의 유일한 정본. 클라이언트·RPC 모두 이 함수를 경유한다.
  SELECT jsonb_build_object(
    'caution_gap_buffer',
      COALESCE((SELECT value_num FROM public.tm_alarm_settings WHERE key='caution_gap_buffer'), 0.05),
    'worsen_gap',
      COALESCE((SELECT value_num FROM public.tm_alarm_settings WHERE key='worsen_gap'), -0.15)
  );
$$;
GRANT EXECUTE ON FUNCTION public.tm_thresholds() TO authenticated, anon, service_role;

-- tm_compute_derived: 임계값을 tm_thresholds() 에서 읽는다 (as_of 규칙 불변)
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
BEGIN
  th := public.tm_thresholds();
  caution := (th->>'caution_gap_buffer')::numeric;
  worsen  := (th->>'worsen_gap')::numeric;

  -- as_of = 판정 기준일. 호출자가 넘긴 값이 정본, 없으면 오늘(Asia/Qatar).
  as_of := coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);
  started := _actual_start IS NOT NULL OR actual > 0;

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

  IF actual >= 1 THEN
    IF _actual_finish IS NOT NULL AND _plan_end IS NOT NULL AND _actual_finish > _plan_end THEN
      delay_d := _actual_finish - _plan_end;
    ELSE
      delay_d := 0;
    END IF;
  ELSIF _plan_end IS NOT NULL AND as_of > _plan_end THEN
    delay_d := as_of - _plan_end;
  ELSE
    delay_d := 0;
  END IF;

  IF actual >= 1 THEN
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

-- B-2. 과거 판정 수리: 실적은 status_history 의 그 시점 관측치를 사용.
--  계획은 "현재본 계획"을 p_data_date 까지 평가 (재계획 존중 — 계획 버전 소급 없음).
--  이력이 전혀 없는 행은 현재값 대입 금지 → actual_source='none' 으로 "이력 없음" 명시 반환.
DROP FUNCTION IF EXISTS public.tm_judge_at_date(date, uuid[]);
CREATE OR REPLACE FUNCTION public.tm_judge_at_date(p_data_date date, p_task_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select t.*
    from public.task_management_raw t
    where t.is_active is not false
      and (p_task_ids is null or t.id = any(p_task_ids))
  ),
  hist as (
    select
      b.id,
      -- 그 시점(포함) 이전 마지막 관측치
      (select h.new_value::numeric
         from public.task_management_status_history h
        where h.task_raw_id = b.id and h.field = 'actual_progress'
          and h.new_value is not null
          and (h.changed_at at time zone 'Asia/Qatar')::date <= coalesce(p_data_date, (current_timestamp at time zone 'Asia/Qatar')::date)
        order by h.changed_at desc limit 1) as at_or_before,
      -- 그 시점 이후 최초 기록의 이전값 = 그 시점의 값(역추적)
      (select h.old_value::numeric
         from public.task_management_status_history h
        where h.task_raw_id = b.id and h.field = 'actual_progress'
          and h.old_value is not null
          and (h.changed_at at time zone 'Asia/Qatar')::date > coalesce(p_data_date, (current_timestamp at time zone 'Asia/Qatar')::date)
        order by h.changed_at asc limit 1) as after_old,
      (select count(*) from public.task_management_status_history h
        where h.task_raw_id = b.id and h.field = 'actual_progress') as hist_rows
    from base b
  ),
  resolved as (
    select
      b.id, b.plan_start, b.plan_end, b.plan_days, b.actual_start, b.actual_finish,
      case when h.at_or_before is not null then h.at_or_before else h.after_old end as hist_actual,
      h.hist_rows
    from base b join hist h on h.id = b.id
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select
      r.id,
      case when r.hist_actual is null then null else (d->>'cum_plan_pct')::numeric end   as cum_plan_pct,
      case when r.hist_actual is null then null else (d->>'cum_actual_pct')::numeric end as cum_actual_pct,
      case when r.hist_actual is null then null else (d->>'gap_pct')::numeric end        as gap_pct,
      case when r.hist_actual is null then null else (d->>'auto_judgment')::text end     as auto_judgment,
      case when r.hist_actual is null then null else (d->>'delay_days')::integer end     as delay_days,
      case when r.hist_actual is null then '이력 없음' else (d->>'alarm_reason')::text end as alarm_reason,
      case when r.hist_actual is null then 'none' else 'history' end                     as actual_source
    from resolved r,
    lateral public.tm_compute_derived(
      r.plan_start, r.plan_end, r.plan_days,
      -- 그 시점 실적이 0 이면 착수 전으로 간주해 actual_start/finish 도 미반영
      case when coalesce(r.hist_actual,0) > 0 then r.actual_start else null end,
      case when coalesce(r.hist_actual,0) >= 1 then r.actual_finish else null end,
      r.hist_actual,
      coalesce(p_data_date, (current_timestamp at time zone 'Asia/Qatar')::date)
    ) d
  ) x;
$function$;

-- B-4. T.Actual 차분 정합: 현재 누계 − 직전 관측 누계(증분).
--  직전 기록이 없으면 값 변경 이력이 없다는 뜻이므로 증분 0 (status_history 는 값 변경 시에만 적재).
CREATE OR REPLACE FUNCTION public.tm_today_actual(_ids uuid[], _as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cur as (
    select t.id, least(1, greatest(0, coalesce(t.actual_progress,0)))::numeric as cum
    from public.task_management_raw t
    where t.id = any(_ids)
  ),
  gen as (
    select c.id, c.cum,
      (select max(h.changed_at) from public.task_management_status_history h
        where h.task_raw_id = c.id and h.field='actual_progress' and h.new_value is not null) as last_ts
    from cur c
  ),
  prev as (
    select g.id, g.cum,
      coalesce(
        (select h.new_value::numeric from public.task_management_status_history h
          where h.task_raw_id = g.id and h.field='actual_progress' and h.new_value is not null
            and h.changed_at < g.last_ts
          order by h.changed_at desc limit 1),
        (select h.old_value::numeric from public.task_management_status_history h
          where h.task_raw_id = g.id and h.field='actual_progress' and h.old_value is not null
            and h.changed_at = g.last_ts
          order by h.changed_at desc limit 1)
      ) as prev_cum
    from gen g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    't_actual', greatest(0, p.cum - coalesce(p.prev_cum, p.cum))
  )), '[]'::jsonb)
  from prev p;
$function$;

-- 검색/집계 RPC 임계값 기본값을 단일 소스로 (명시 인자가 오면 그 값 우선)
CREATE OR REPLACE FUNCTION public.tm_resolve_caution(_v numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS
$$ select coalesce(_v, (public.tm_thresholds()->>'caution_gap_buffer')::numeric) $$;

CREATE OR REPLACE FUNCTION public.tm_resolve_worsen(_v numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public' AS
$$ select coalesce(_v, (public.tm_thresholds()->>'worsen_gap')::numeric) $$;

GRANT EXECUTE ON FUNCTION public.tm_resolve_caution(numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_resolve_worsen(numeric) TO authenticated, anon, service_role;
