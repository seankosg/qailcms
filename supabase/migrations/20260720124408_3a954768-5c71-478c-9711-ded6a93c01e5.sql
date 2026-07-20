
-- Sub Task 파생 필드 자동 계산 트리거

CREATE OR REPLACE FUNCTION public.calc_sub_task_derived_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  as_of date;
  pd int;
  pp numeric;
  ap numeric;
  sd int;
BEGIN
  -- Sub 태스크만 대상. Main은 롤업에서 계산.
  IF NEW.level IS DISTINCT FROM 'sub' THEN
    RETURN NEW;
  END IF;

  as_of := COALESCE(NEW.data_date, CURRENT_DATE);

  -- plan_days
  IF NEW.plan_start IS NOT NULL AND NEW.plan_end IS NOT NULL THEN
    pd := (NEW.plan_end - NEW.plan_start) + 1;
    IF pd < 1 THEN pd := 1; END IF;
  ELSE
    pd := NULL;
  END IF;
  NEW.plan_days := pd;

  -- plan_progress (T.Plan)
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

  -- progress_variance
  ap := COALESCE(NEW.actual_progress, 0);
  IF pp IS NULL THEN
    NEW.progress_variance := NULL;
  ELSE
    NEW.progress_variance := round(ap - pp, 4);
  END IF;

  -- slip_days
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

  RETURN NEW;
END;
$$;

-- 기존 트리거 제거 후 재부착 (BEFORE INSERT/UPDATE, actual_duration 트리거보다 앞서 실행되도록 이름을 앞선 알파벳으로)
DROP TRIGGER IF EXISTS aaa_trg_task_sub_derived ON public.task_management_raw;
CREATE TRIGGER aaa_trg_task_sub_derived
  BEFORE INSERT OR UPDATE OF plan_start, plan_end, data_date, actual_progress, actual_finish, level
  ON public.task_management_raw
  FOR EACH ROW
  EXECUTE FUNCTION public.calc_sub_task_derived_fn();

-- 기존 Sub 데이터 1회 재계산: 트리거를 강제 발화
UPDATE public.task_management_raw
   SET plan_start = plan_start
 WHERE level = 'sub';

-- Main 롤업 재실행: 모든 (discipline, main_task_no) 조합에 대해 update_task_summary 호출
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT discipline, main_task_no
      FROM public.task_management_raw
     WHERE level = 'sub' AND main_task_no IS NOT NULL AND discipline IS NOT NULL
  LOOP
    PERFORM public.update_task_summary(r.discipline, r.main_task_no);
  END LOOP;
END $$;

-- auto_judgment 재계산 (plan_progress/slip_days 변경분 반영)
SELECT public.recalc_task_auto_judgment();
