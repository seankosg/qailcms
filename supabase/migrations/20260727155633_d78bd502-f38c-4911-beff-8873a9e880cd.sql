-- v2 snapshot (idempotent)
DROP TABLE IF EXISTS public.abd_latest_status_restore_snapshot_v2_20260727;
CREATE TABLE public.abd_latest_status_restore_snapshot_v2_20260727 AS
SELECT id, abd_number, latest_status, is_terminated, updated_at, now() AS snapshot_at
FROM public.abd_items_raw
WHERE latest_status IS NULL;

GRANT SELECT ON public.abd_latest_status_restore_snapshot_v2_20260727 TO authenticated;
GRANT ALL ON public.abd_latest_status_restore_snapshot_v2_20260727 TO service_role;
ALTER TABLE public.abd_latest_status_restore_snapshot_v2_20260727 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "v2_snap_admin_read" ON public.abd_latest_status_restore_snapshot_v2_20260727
  FOR SELECT TO authenticated USING (public.is_admin_or_super(auth.uid()));

-- Restore: use latest old_value from upload a71793fa where current is NULL
WITH src AS (
  SELECT DISTINCT ON (cl.abd_item_id)
    cl.abd_item_id, cl.old_value
  FROM public.abd_change_log cl
  JOIN public.abd_items_raw r ON r.id = cl.abd_item_id
  WHERE cl.upload_id = 'a71793fa-216a-4922-b7a9-babc37ec1762'
    AND cl.field = 'latest_status'
    AND cl.old_value IS NOT NULL
    AND r.latest_status IS NULL
  ORDER BY cl.abd_item_id, cl.changed_at DESC
)
UPDATE public.abd_items_raw r
SET latest_status = src.old_value
FROM src
WHERE r.id = src.abd_item_id
  AND r.latest_status IS NULL;