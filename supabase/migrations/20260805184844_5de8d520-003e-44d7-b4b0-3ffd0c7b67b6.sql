CREATE OR REPLACE FUNCTION public.abd_guard_ds_actual_requires_mf()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  n int;
  newv date;
  oldv date;
  changed boolean := false;
  src text;
BEGIN
  -- Gate 1 은 사용자의 수동 입력 경로에만 적용한다. 임포트 등 일괄 경로는 제외.
  src := coalesce(current_setting('app.change_source', true), '');
  IF src NOT IN ('manual', 'revise', 'revise-bulk') THEN
    RETURN NEW;
  END IF;

  FOR n IN 1..3 LOOP
    newv := CASE n WHEN 1 THEN NEW.r1_draft_start_actual WHEN 2 THEN NEW.r2_draft_start_actual ELSE NEW.r3_draft_start_actual END;
    IF TG_OP = 'UPDATE' THEN
      oldv := CASE n WHEN 1 THEN OLD.r1_draft_start_actual WHEN 2 THEN OLD.r2_draft_start_actual ELSE OLD.r3_draft_start_actual END;
    ELSE
      oldv := NULL;
    END IF;
    IF newv IS NOT NULL AND newv IS DISTINCT FROM oldv THEN
      changed := true;
    END IF;
  END LOOP;

  IF changed AND NOT public.abd_mf_ready(NEW) THEN
    RAISE EXCEPTION 'MF_NOT_READY: Master Reference 확인이 완료되지 않았습니다. MF 종류와 Reference를 입력한 후 MF Check를 완료하십시오.';
  END IF;
  RETURN NEW;
END $$;
