
-- 1) BEFORE INSERT/UPDATE trigger: auto-derive main_task_no + level for orphan subs
CREATE OR REPLACE FUNCTION public.trg_task_autofill_parent_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_tail text;
  v_parent_exists boolean;
BEGIN
  -- Only act when main_task_no is missing and task_no looks like <PREFIX>-<digits>
  IF NEW.main_task_no IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.task_no IS NULL OR position('-' in NEW.task_no) = 0 THEN
    RETURN NEW;
  END IF;
  -- Split last segment
  v_tail := split_part(NEW.task_no, '-', array_length(string_to_array(NEW.task_no, '-'), 1));
  IF v_tail !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;
  v_prefix := left(NEW.task_no, length(NEW.task_no) - length(v_tail) - 1);
  IF v_prefix IS NULL OR v_prefix = '' THEN
    RETURN NEW;
  END IF;
  -- Verify prefix exists as a main task in same discipline
  SELECT EXISTS (
    SELECT 1 FROM public.task_management_raw
    WHERE discipline = NEW.discipline
      AND task_no = v_prefix
      AND level = 'main'
  ) INTO v_parent_exists;
  IF v_parent_exists THEN
    NEW.main_task_no := v_prefix;
    IF NEW.level IS NULL OR NEW.level <> 'sub' THEN
      NEW.level := 'sub';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aab_trg_task_autofill_parent ON public.task_management_raw;
CREATE TRIGGER aab_trg_task_autofill_parent
BEFORE INSERT OR UPDATE OF task_no, main_task_no, discipline, level
ON public.task_management_raw
FOR EACH ROW EXECUTE FUNCTION public.trg_task_autofill_parent_fn();

-- 2) Rollup trigger defensive: also handle NULL main_task_no via prefix derivation
CREATE OR REPLACE FUNCTION public.trg_task_rollup_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix text;
  v_tail text;
  v_parent text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.main_task_no IS NOT NULL AND OLD.level = 'sub' THEN
      PERFORM public.update_task_summary(OLD.discipline, OLD.main_task_no);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.main_task_no IS DISTINCT FROM NEW.main_task_no
       AND OLD.main_task_no IS NOT NULL AND OLD.level = 'sub' THEN
      PERFORM public.update_task_summary(OLD.discipline, OLD.main_task_no);
    END IF;
  END IF;

  IF NEW.level = 'sub' THEN
    IF NEW.main_task_no IS NOT NULL THEN
      PERFORM public.update_task_summary(NEW.discipline, NEW.main_task_no);
    ELSIF NEW.task_no IS NOT NULL AND position('-' in NEW.task_no) > 0 THEN
      v_tail := split_part(NEW.task_no, '-', array_length(string_to_array(NEW.task_no, '-'), 1));
      IF v_tail ~ '^[0-9]+$' THEN
        v_prefix := left(NEW.task_no, length(NEW.task_no) - length(v_tail) - 1);
        SELECT task_no INTO v_parent
          FROM public.task_management_raw
         WHERE discipline = NEW.discipline AND task_no = v_prefix AND level = 'main'
         LIMIT 1;
        IF v_parent IS NOT NULL THEN
          PERFORM public.update_task_summary(NEW.discipline, v_parent);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) One-time backfill: link orphan subs then re-rollup all mains
UPDATE public.task_management_raw s
   SET main_task_no = m.task_no,
       level = 'sub'
  FROM public.task_management_raw m
 WHERE s.main_task_no IS NULL
   AND m.level = 'main'
   AND m.discipline = s.discipline
   AND s.task_no LIKE m.task_no || '-%'
   AND substring(s.task_no from length(m.task_no) + 2) ~ '^[0-9]+$';

-- Re-rollup every main
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT discipline, main_task_no
      FROM public.task_management_raw
     WHERE main_task_no IS NOT NULL AND level = 'sub'
  LOOP
    PERFORM public.update_task_summary(r.discipline, r.main_task_no);
  END LOOP;
END $$;
