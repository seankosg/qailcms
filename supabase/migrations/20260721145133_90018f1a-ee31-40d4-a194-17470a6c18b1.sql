UPDATE public.defect_items_raw
SET planned_start_date = actual_start_date,
    updated_at = now()
WHERE actual_start_date IS NOT NULL
  AND planned_start_date IS NULL;