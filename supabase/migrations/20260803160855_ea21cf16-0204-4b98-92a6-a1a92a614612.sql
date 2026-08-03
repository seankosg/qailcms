ALTER TABLE public.defect_items_raw
  ADD COLUMN IF NOT EXISTS manual_locked_fields text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS manual_locked_at timestamptz;

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
  -- 수동 편집 경로는 manual_locked_at 을 갱신한다 -> 보호 통과
  IF NEW.manual_locked_at IS DISTINCT FROM OLD.manual_locked_at THEN
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
  nj := jsonb_set(nj, '{manual_locked_fields}', to_jsonb(OLD.manual_locked_fields));
  NEW := jsonb_populate_record(NEW, nj);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_defect_manual_lock_guard ON public.defect_items_raw;
CREATE TRIGGER a_defect_manual_lock_guard
  BEFORE UPDATE ON public.defect_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.trg_defect_manual_lock_guard();