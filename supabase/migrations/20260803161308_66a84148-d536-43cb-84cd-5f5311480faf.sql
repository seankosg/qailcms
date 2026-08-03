CREATE OR REPLACE FUNCTION public.trg_defect_manual_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  nj jsonb;
  oj jsonb;
  f text;
BEGIN
  -- 수동 편집 경로는 manual_locked_fields 또는 manual_locked_at 를 함께 갱신한다 -> 보호 통과
  IF NEW.manual_locked_at IS DISTINCT FROM OLD.manual_locked_at
     OR NEW.manual_locked_fields IS DISTINCT FROM OLD.manual_locked_fields THEN
    RETURN NEW;
  END IF;
  IF OLD.manual_locked_fields IS NULL
     OR array_length(OLD.manual_locked_fields, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  nj := to_jsonb(NEW);
  oj := to_jsonb(OLD);
  FOREACH f IN ARRAY OLD.manual_locked_fields LOOP
    IF oj ? f THEN
      nj := jsonb_set(nj, ARRAY[f], oj -> f);
    END IF;
  END LOOP;
  NEW := jsonb_populate_record(NEW, nj);
  RETURN NEW;
END;
$$;