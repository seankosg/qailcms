CREATE INDEX IF NOT EXISTS idx_tmsh_taskraw_field_changed
  ON public.task_management_status_history (task_raw_id, field, changed_at DESC)
  WHERE new_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tmsh_taskraw_field_changed_old
  ON public.task_management_status_history (task_raw_id, field, changed_at DESC);

ANALYZE public.task_management_status_history;