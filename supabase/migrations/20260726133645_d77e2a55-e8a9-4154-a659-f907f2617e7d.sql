CREATE OR REPLACE FUNCTION public.trg_task_main_no_cascade_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.level, '') = 'main'
     AND COALESCE(NEW.level, '') = 'main'
     AND OLD.task_no IS DISTINCT FROM NEW.task_no
     AND OLD.task_no IS NOT NULL
     AND NEW.task_no IS NOT NULL THEN
    UPDATE public.task_management_raw
       SET main_task_no = NEW.task_no
     WHERE discipline = NEW.discipline
       AND level = 'sub'
       AND main_task_no = OLD.task_no;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_main_no_cascade ON public.task_management_raw;
CREATE TRIGGER trg_task_main_no_cascade
AFTER UPDATE OF task_no ON public.task_management_raw
FOR EACH ROW
WHEN (
  OLD.level = 'main'
  AND NEW.level = 'main'
  AND OLD.task_no IS DISTINCT FROM NEW.task_no
)
EXECUTE FUNCTION public.trg_task_main_no_cascade_fn();