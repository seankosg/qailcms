
-- 1) 파생 컬럼 추가
ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS cum_plan_pct   numeric,
  ADD COLUMN IF NOT EXISTS cum_actual_pct numeric,
  ADD COLUMN IF NOT EXISTS gap_pct        numeric,
  ADD COLUMN IF NOT EXISTS delay_days     integer,
  ADD COLUMN IF NOT EXISTS alarm_reason   text;

-- 2) 표준 판정 헬퍼 (트리거+RPC 공유). Cum.Plan 공식은 ((asOf-plan_start)+1)/plan_days.
CREATE OR REPLACE FUNCTION public.tm_compute_derived(
  _plan_start     date,
  _plan_end       date,
  _plan_days      integer,
  _actual_start   date,
  _actual_finish  date,
  _actual_progress numeric,
  _data_date      date
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
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
  caution       numeric;
  worsen        numeric;
BEGIN
  SELECT coalesce(caution_gap_buffer, 0.05), coalesce(worsen_gap, -0.15)
    INTO caution, worsen
    FROM public.task_management_settings WHERE id = 'default';
  caution := coalesce(caution, 0.05);
  worsen  := coalesce(worsen, -0.15);

  as_of := coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);
  started := _actual_start IS NOT NULL OR actual > 0;

  -- plan_days 정규화 (달력일 기준: end-start+1)
  IF _plan_days IS NOT NULL AND _plan_days > 0 THEN
    pd := _plan_days;
  ELSIF _plan_start IS NOT NULL AND _plan_end IS NOT NULL THEN
    pd := greatest(1, (_plan_end - _plan_start) + 1);
  ELSE
    pd := NULL;
  END IF;

  -- Cum.Plan% 표준식
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

  -- 지연일수 (완료 시 지연 없음, 미완료+plan_end 도과 시 as_of-plan_end)
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

  -- 판정
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
$$;

GRANT EXECUTE ON FUNCTION public.tm_compute_derived(date,date,integer,date,date,numeric,date) TO anon, authenticated, service_role;

-- 3) calc_auto_judgment_value 를 헬퍼 호출로 재작성 (backward compat 시그니처 유지)
CREATE OR REPLACE FUNCTION public.calc_auto_judgment_value(
  _actual_progress numeric,
  _plan_start date,
  _plan_end date,
  _plan_days integer,
  _actual_start date,
  _actual_finish date,
  _data_date date,
  _slip_days integer
) RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT (public.tm_compute_derived(
    _plan_start, _plan_end, _plan_days,
    _actual_start, _actual_finish, _actual_progress, _data_date
  ) ->> 'auto_judgment')::text
$$;

-- 4) sub 태스크 트리거 확장 — 파생 컬럼과 auto_judgment 도 한 번에 저장
CREATE OR REPLACE FUNCTION public.calc_sub_task_derived_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  as_of date;
  pd int;
  pp numeric;
  ap numeric;
  sd int;
  d jsonb;
BEGIN
  IF NEW.level IS DISTINCT FROM 'sub' THEN
    RETURN NEW;
  END IF;

  as_of := COALESCE(NEW.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date);

  IF NEW.plan_start IS NOT NULL AND NEW.plan_end IS NOT NULL THEN
    pd := (NEW.plan_end - NEW.plan_start) + 1;
    IF pd < 1 THEN pd := 1; END IF;
  ELSE
    pd := NULL;
  END IF;
  NEW.plan_days := pd;

  -- plan_progress (표시용 Cum.Plan)
  IF NEW.plan_start IS NULL OR NEW.plan_end IS NULL OR pd IS NULL OR pd < 1 THEN
    pp := NULL;
  ELSIF as_of < NEW.plan_start THEN
    pp := 0;
  ELSIF as_of >= NEW.plan_end THEN
    pp := 1;
  ELSE
    pp := ((as_of - NEW.plan_start) + 1)::numeric / pd::numeric;
    IF pp < 0 THEN pp := 0; ELSIF pp > 1 THEN pp := 1; END IF;
  END IF;
  NEW.plan_progress := CASE WHEN pp IS NULL THEN NULL ELSE round(pp, 4) END;

  ap := COALESCE(NEW.actual_progress, 0);
  IF pp IS NULL THEN
    NEW.progress_variance := NULL;
  ELSE
    NEW.progress_variance := round(ap - pp, 4);
  END IF;

  IF NEW.plan_end IS NULL THEN
    sd := NULL;
  ELSIF COALESCE(NEW.actual_progress, 0) >= 0.999 THEN
    IF NEW.actual_finish IS NOT NULL THEN
      sd := GREATEST(0, NEW.actual_finish - NEW.plan_end);
    ELSE
      sd := GREATEST(0, as_of - NEW.plan_end);
    END IF;
  ELSE
    sd := GREATEST(0, as_of - NEW.plan_end);
  END IF;
  NEW.slip_days := sd;

  -- 판정 및 파생 컬럼 (표준 헬퍼)
  d := public.tm_compute_derived(
    NEW.plan_start, NEW.plan_end, NEW.plan_days,
    NEW.actual_start, NEW.actual_finish, NEW.actual_progress, NEW.data_date
  );
  NEW.cum_plan_pct   := (d->>'cum_plan_pct')::numeric;
  NEW.cum_actual_pct := (d->>'cum_actual_pct')::numeric;
  NEW.gap_pct        := (d->>'gap_pct')::numeric;
  NEW.delay_days     := (d->>'delay_days')::integer;
  NEW.alarm_reason   := d->>'alarm_reason';
  NEW.auto_judgment  := d->>'auto_judgment';

  RETURN NEW;
END;
$$;

-- 5) Main 롤업(update_task_summary) 도 파생 컬럼을 함께 갱신하도록 확장.
--    기존 함수 시그니처/책임은 유지하고 결과 UPDATE 문에 파생 컬럼을 추가.
CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
declare
  agg record;
  worst_sub text;
  worst_main text;
  worst text;
  rank_order text[] := array['악화','지연','주의','정상','완료'];
  _ad integer;
  _data_date date;
  _plan_days integer;
  _actual_progress numeric;
  _plan_start date;
  _plan_end date;
  _actual_start date;
  _actual_finish date;
  _slip_days integer;
  d jsonb;
begin
  if _parent_task_no is null then return; end if;

  select
    sum(least(1, greatest(0, coalesce(actual_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(least(1, greatest(0, coalesce(plan_progress,0))) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps,
    max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_,
    max(actual_finish) as af_,
    bool_and(actual_finish is not null or least(1, greatest(0, coalesce(actual_progress,0))) >= 1) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline
    and main_task_no = _parent_task_no
    and level = 'sub';

  if agg.cnt = 0 then return; end if;

  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := ((current_timestamp AT TIME ZONE 'Asia/Qatar')::date - agg.as_) + 1;
  end if;

  select r into worst_sub from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_parent_task_no
      and level='sub' and auto_judgment = x.r
  )
  order by idx
  limit 1;

  -- Main 자신의 계획/실적 값 확보
  select data_date, plan_days, actual_progress, plan_start, plan_end, actual_start, actual_finish, slip_days
    into _data_date, _plan_days, _actual_progress, _plan_start, _plan_end, _actual_start, _actual_finish, _slip_days
  from public.task_management_raw
  where discipline = _discipline and task_no = _parent_task_no and level = 'main'
  limit 1;

  -- Main 파생 (롤업 값을 기본으로 하되 자체 값 있으면 우선)
  d := public.tm_compute_derived(
    coalesce(_plan_start, agg.ps),
    coalesce(_plan_end, agg.pe),
    coalesce(_plan_days, agg.pd::int),
    coalesce(_actual_start, agg.as_),
    case when agg.all_finished then coalesce(_actual_finish, agg.af_) else _actual_finish end,
    coalesce(_actual_progress, agg.ap),
    coalesce(_data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date)
  );
  worst_main := d->>'auto_judgment';

  if not agg.all_finished and worst_main = '완료' then
    worst_main := coalesce(worst_sub, '정상');
  end if;

  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where x.r = coalesce(worst_sub, '정상') or x.r = coalesce(worst_main, '정상')
  order by idx
  limit 1;

  update public.task_management_raw
     set actual_progress = coalesce(agg.ap, actual_progress),
         plan_progress   = coalesce(agg.pp, plan_progress),
         plan_start      = coalesce(plan_start, agg.ps),
         plan_end        = coalesce(plan_end, agg.pe),
         plan_days       = coalesce(plan_days, agg.pd::int),
         actual_start    = coalesce(actual_start, agg.as_),
         actual_finish   = case when agg.all_finished then coalesce(actual_finish, agg.af_) else actual_finish end,
         actual_duration = _ad,
         forecast_end    = coalesce(forecast_end, agg.fe),
         slip_days       = coalesce(slip_days, agg.sd),
         auto_judgment   = coalesce(worst, auto_judgment),
         cum_plan_pct    = (d->>'cum_plan_pct')::numeric,
         cum_actual_pct  = (d->>'cum_actual_pct')::numeric,
         gap_pct         = (d->>'gap_pct')::numeric,
         delay_days      = (d->>'delay_days')::integer,
         alarm_reason    = d->>'alarm_reason',
         updated_at      = now()
   where discipline = _discipline
     and task_no    = _parent_task_no
     and level      = 'main';
end;
$$;

-- 6) 동적 재판정 RPC: 지정 Data Date 로 즉석 재계산 (저장하지 않음)
CREATE OR REPLACE FUNCTION public.tm_judge_at_date(
  p_data_date date,
  p_task_ids  uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  cum_plan_pct   numeric,
  cum_actual_pct numeric,
  gap_pct        numeric,
  auto_judgment  text,
  delay_days     integer,
  alarm_reason   text
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT
    t.id,
    (d->>'cum_plan_pct')::numeric,
    (d->>'cum_actual_pct')::numeric,
    (d->>'gap_pct')::numeric,
    (d->>'auto_judgment')::text,
    (d->>'delay_days')::integer,
    (d->>'alarm_reason')::text
  FROM public.task_management_raw t,
  LATERAL public.tm_compute_derived(
    t.plan_start, t.plan_end, t.plan_days,
    t.actual_start, t.actual_finish, t.actual_progress,
    coalesce(p_data_date, t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date)
  ) d
  WHERE t.is_active IS NOT FALSE
    AND (p_task_ids IS NULL OR t.id = ANY(p_task_ids));
$$;

GRANT EXECUTE ON FUNCTION public.tm_judge_at_date(date, uuid[]) TO authenticated, service_role;

-- 7) 전체 sub 재계산 (트리거 재실행)
UPDATE public.task_management_raw
   SET updated_at = updated_at
 WHERE level = 'sub';

-- 8) Main 롤업 재실행
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT discipline, main_task_no
      FROM public.task_management_raw
     WHERE level='sub' AND main_task_no IS NOT NULL
  LOOP
    PERFORM public.update_task_summary(r.discipline, r.main_task_no);
  END LOOP;
END $$;
