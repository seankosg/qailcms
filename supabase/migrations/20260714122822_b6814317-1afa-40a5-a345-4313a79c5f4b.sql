CREATE INDEX IF NOT EXISTS idx_defect_items_raw_dashboard_active
ON public.defect_items_raw (plan_group, team, building, level_name, room_group, status_raw)
WHERE is_active = true;