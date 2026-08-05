-- REVERT for migration 20260805170403 (RCL grid pin, 60 cells)
-- NOT executed. Restores the pre-pin value observed 2026-08-05 20:03 (Asia/Qatar).
-- Only one cell was changed by the forward migration.
UPDATE public.rcl_permissions
   SET allowed = false
 WHERE role::text = 'd_superuser'
   AND scope::text = 'other_team'
   AND action::text = 'import'
   AND allowed IS DISTINCT FROM false;
