UPDATE public.task_management_raw
SET actual_finish = COALESCE(forecast_end, data_date)
WHERE actual_progress = 1
  AND actual_finish IS NULL
  AND COALESCE(forecast_end, data_date) IS NOT NULL;