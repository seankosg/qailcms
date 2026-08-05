CREATE OR REPLACE FUNCTION public.abd_guard_df_actual_requires_ocs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pending int;
  n int;
  v_new date;
  v_old date;
  v_active int;
BEGIN
  v_pending := GREATEST(COALESCE(NEW.ocs_total, 0) - COALESCE(NEW.ocs_complied, 0), 0);
  IF v_pending = 0 AND COALESCE(NEW.ocs_check, 'none') <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- 현재(활성) 라운드만 차단 대상. 과거 라운드 실적일은 자유 편집.
  BEGIN
    v_active := NULLIF(regexp_replace(COALESCE((public.abd_judge_v1(NEW, CURRENT_DATE)->>'active_round'), ''), '\D', '', 'g'), '')::int;
  EXCEPTION WHEN OTHERS THEN
    v_active := NULL;
  END;
  IF v_active IS NULL THEN
    RETURN NEW;
  END IF;

  FOR n IN 1..3 LOOP
    IF n <> v_active THEN
      CONTINUE;
    END IF;
    v_new := CASE n WHEN 1 THEN NEW.r1_draft_finish_actual WHEN 2 THEN NEW.r2_draft_finish_actual ELSE NEW.r3_draft_finish_actual END;
    IF TG_OP = 'UPDATE' THEN
      v_old := CASE n WHEN 1 THEN OLD.r1_draft_finish_actual WHEN 2 THEN OLD.r2_draft_finish_actual ELSE OLD.r3_draft_finish_actual END;
    ELSE
      v_old := NULL;
    END IF;
    IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
      RAISE EXCEPTION 'OCS 미완료 도면입니다 (Pending %건). R% Draft Finish 실적일을 입력할 수 없습니다: %',
        v_pending, n, COALESCE(NEW.abd_number, '')
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;