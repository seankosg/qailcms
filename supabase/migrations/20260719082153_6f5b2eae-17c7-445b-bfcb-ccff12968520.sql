CREATE OR REPLACE PROCEDURE public._backfill_plan_dates_from_actual()
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected int;
BEGIN
  ALTER TABLE public.defect_items_raw DISABLE TRIGGER trg_defect_items_raw_history;

  LOOP
    WITH batch AS (
      SELECT id FROM public.defect_items_raw
      WHERE planned_start_date IS NULL AND actual_start_date IS NOT NULL AND actual_start_date < DATE '2026-07-16'
      LIMIT 5000
    )
    UPDATE public.defect_items_raw d SET planned_start_date = d.actual_start_date
    FROM batch WHERE d.id = batch.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;
  END LOOP;

  LOOP
    WITH batch AS (
      SELECT id FROM public.defect_items_raw
      WHERE planned_rectified_date IS NULL AND actual_rectified_date IS NOT NULL AND actual_rectified_date < DATE '2026-07-16'
      LIMIT 5000
    )
    UPDATE public.defect_items_raw d SET planned_rectified_date = d.actual_rectified_date
    FROM batch WHERE d.id = batch.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;
  END LOOP;

  LOOP
    WITH batch AS (
      SELECT id FROM public.defect_items_raw
      WHERE planned_closure_date IS NULL AND actual_closure_date IS NOT NULL AND actual_closure_date < DATE '2026-07-16'
      LIMIT 5000
    )
    UPDATE public.defect_items_raw d SET planned_closure_date = d.actual_closure_date
    FROM batch WHERE d.id = batch.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;
  END LOOP;

  ALTER TABLE public.defect_items_raw ENABLE TRIGGER trg_defect_items_raw_history;
END;
$$;